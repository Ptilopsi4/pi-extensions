import { ensureDevToolsEndpoint, fetchDevToolsJson } from "../browser-manager.js";
import { CdpClient } from "../cdp-client.js";
import { DEFAULT_TIMEOUT_MS, type DevToolsPage } from "../runtime.js";

export interface WebMcpProtocolAnnotation {
	autosubmit?: boolean;
	consequential?: boolean;
	readOnly?: boolean;
	untrustedContent?: boolean;
}

export interface WebMcpProtocolTool {
	annotations?: WebMcpProtocolAnnotation;
	backendNodeId?: number;
	description: string;
	frameId: string;
	inputSchema?: Record<string, unknown>;
	name: string;
	title?: string;
}

export interface WebMcpFrame {
	id: string;
	loaderId: string;
	securityOrigin?: string;
	url: string;
}

export interface WebMcpInvocationResponse {
	errorText?: string;
	exception?: unknown;
	invocationId: string;
	output?: unknown;
	status: "Canceled" | "Completed" | "Error";
}

interface ProtocolDescription {
	domains?: unknown;
}

const REQUIRED_COMMANDS = ["enable", "disable", "invokeTool", "cancelInvocation"];
const REQUIRED_EVENTS = ["toolsAdded", "toolsRemoved", "toolInvoked", "toolResponded"];

export async function requireWebMcpDomain(signal: AbortSignal) {
	signal.throwIfAborted();
	await ensureDevToolsEndpoint(undefined, signal);
	signal.throwIfAborted();
	const protocol = await fetchDevToolsJson<ProtocolDescription>("/json/protocol", { signal });
	signal.throwIfAborted();
	const domain = findDomain(protocol.domains, "WebMCP");
	if (
		!domain ||
		!hasNamedEntries(domain.commands, REQUIRED_COMMANDS) ||
		!hasNamedEntries(domain.events, REQUIRED_EVENTS)
	) {
		throw new Error(
			"This browser does not expose the experimental Chrome DevTools WebMCP domain. Use a compatible Chrome build and enable the website's required Origin Trial or WebMCP testing feature.",
		);
	}
}

export async function connectWebMcpPage(page: DevToolsPage, signal: AbortSignal) {
	if (!page.webSocketDebuggerUrl) throw new Error(`Page has no webSocketDebuggerUrl: ${page.id}`);
	return CdpClient.connect(page.webSocketDebuggerUrl, {
		signal: withDeadline(signal),
	});
}

export async function enableWebMcp(client: CdpClient, signal: AbortSignal) {
	const eventController = new AbortController();
	const eventSignal = AbortSignal.any([signal, eventController.signal]);
	const toolsAdded = client.waitForEvent(
		"WebMCP.toolsAdded",
		(value): value is { tools: WebMcpProtocolTool[] } => {
			const parsed = parseToolsAdded(value);
			if (!parsed) throw new Error("Chrome sent a malformed WebMCP.toolsAdded event");
			return true;
		},
		{ signal: eventSignal, timeoutMs: DEFAULT_TIMEOUT_MS },
	);
	try {
		await client.send("WebMCP.enable", {}, { signal, timeoutMs: DEFAULT_TIMEOUT_MS });
	} catch (error) {
		eventController.abort();
		await toolsAdded.catch(() => undefined);
		throw error;
	}
	try {
		const event = await toolsAdded;
		const parsed = parseToolsAdded(event);
		if (!parsed) throw new Error("Chrome sent a malformed WebMCP.toolsAdded event");
		return parsed.tools;
	} finally {
		eventController.abort();
	}
}

export async function disableWebMcp(client: CdpClient) {
	try {
		await client.send("WebMCP.disable", {}, { timeoutMs: 1_000 });
	} catch {
		// Best-effort cleanup: the target may already be detached or the domain may be unavailable.
	}
}

export async function readWebMcpFrames(client: CdpClient, signal: AbortSignal) {
	const result = await client.send<unknown>(
		"Page.getFrameTree",
		{},
		{
			signal,
			timeoutMs: DEFAULT_TIMEOUT_MS,
		},
	);
	const frames = parseFrameTree(result);
	if (!frames) throw new Error("Chrome sent a malformed Page.getFrameTree response");
	return frames;
}

export async function invokeWebMcpTool(
	client: CdpClient,
	request: { frameId: string; input: Record<string, unknown>; toolName: string },
	signal: AbortSignal,
): Promise<WebMcpInvocationResponse> {
	signal.throwIfAborted();
	let invocationId: string | undefined;
	let cancellation: Promise<unknown> | undefined;
	const cancel = () => {
		if (!invocationId || cancellation) return;
		try {
			cancellation = client
				.send("WebMCP.cancelInvocation", { invocationId }, { timeoutMs: 1_000 })
				.catch(() => undefined);
		} catch {
			cancellation = Promise.resolve();
		}
	};
	const onAbort = () => cancel();
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		let response: unknown;
		try {
			response = await client.send<unknown>(
				"WebMCP.invokeTool",
				{ frameId: request.frameId, toolName: request.toolName, input: request.input },
				{ timeoutMs: DEFAULT_TIMEOUT_MS },
			);
		} catch (error) {
			if (signal.aborted) throw signal.reason;
			throw error;
		}
		invocationId = parseInvocationId(response);
		if (!invocationId) throw new Error("Chrome sent a malformed WebMCP.invokeTool response");
		if (signal.aborted) cancel();
		let event: WebMcpInvocationResponse;
		try {
			event = await client.waitForEvent(
				"WebMCP.toolResponded",
				(value): value is WebMcpInvocationResponse => {
					const parsed = parseToolResponded(value);
					if (!parsed) throw new Error("Chrome sent a malformed WebMCP.toolResponded event");
					return parsed.invocationId === invocationId;
				},
				{ timeoutMs: DEFAULT_TIMEOUT_MS },
			);
		} catch (error) {
			if (signal.aborted) throw signal.reason;
			throw error;
		}
		if (signal.aborted) throw signal.reason;
		return event;
	} finally {
		signal.removeEventListener("abort", onAbort);
		await cancellation;
	}
}

function findDomain(value: unknown, name: string): Record<string, unknown> | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.find(
		(candidate): candidate is Record<string, unknown> =>
			isRecord(candidate) && candidate.domain === name,
	);
}

function hasNamedEntries(value: unknown, required: readonly string[]) {
	if (!Array.isArray(value)) return false;
	const names = new Set(
		value.flatMap((candidate) =>
			isRecord(candidate) && typeof candidate.name === "string" ? [candidate.name] : [],
		),
	);
	return required.every((name) => names.has(name));
}

function parseToolsAdded(value: unknown): { tools: WebMcpProtocolTool[] } | undefined {
	if (!isRecord(value) || !Array.isArray(value.tools)) return undefined;
	const tools: WebMcpProtocolTool[] = [];
	for (const candidate of value.tools) {
		const tool = parseTool(candidate);
		if (!tool) return undefined;
		tools.push(tool);
	}
	return { tools };
}

function parseTool(value: unknown): WebMcpProtocolTool | undefined {
	if (
		!isRecord(value) ||
		typeof value.name !== "string" ||
		typeof value.description !== "string" ||
		typeof value.frameId !== "string" ||
		(value.inputSchema !== undefined && !isRecord(value.inputSchema)) ||
		(value.title !== undefined && typeof value.title !== "string") ||
		(value.backendNodeId !== undefined && typeof value.backendNodeId !== "number")
	) {
		return undefined;
	}
	const annotations = parseAnnotations(value.annotations);
	if (value.annotations !== undefined && !annotations) return undefined;
	return {
		name: value.name,
		description: value.description,
		frameId: value.frameId,
		...(value.title === undefined ? {} : { title: value.title }),
		...(value.inputSchema === undefined ? {} : { inputSchema: value.inputSchema }),
		...(annotations ? { annotations } : {}),
		...(value.backendNodeId === undefined ? {} : { backendNodeId: value.backendNodeId }),
	};
}

function parseAnnotations(value: unknown): WebMcpProtocolAnnotation | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) return undefined;
	const annotations: WebMcpProtocolAnnotation = {};
	for (const key of ["autosubmit", "consequential", "readOnly", "untrustedContent"] as const) {
		if (value[key] === undefined) continue;
		if (typeof value[key] !== "boolean") return undefined;
		annotations[key] = value[key];
	}
	return annotations;
}

function parseFrameTree(value: unknown): WebMcpFrame[] | undefined {
	if (!isRecord(value) || !isRecord(value.frameTree)) return undefined;
	const frames: WebMcpFrame[] = [];
	const visit = (tree: unknown): boolean => {
		if (!isRecord(tree) || !isRecord(tree.frame)) return false;
		const frame = tree.frame;
		if (
			typeof frame.id !== "string" ||
			typeof frame.loaderId !== "string" ||
			typeof frame.url !== "string" ||
			(frame.securityOrigin !== undefined && typeof frame.securityOrigin !== "string")
		) {
			return false;
		}
		frames.push({
			id: frame.id,
			loaderId: frame.loaderId,
			url: frame.url,
			...(frame.securityOrigin === undefined ? {} : { securityOrigin: frame.securityOrigin }),
		});
		if (tree.childFrames === undefined) return true;
		return Array.isArray(tree.childFrames) && tree.childFrames.every(visit);
	};
	return visit(value.frameTree) ? frames : undefined;
}

function parseInvocationId(value: unknown) {
	return isRecord(value) && typeof value.invocationId === "string" ? value.invocationId : undefined;
}

function parseToolResponded(value: unknown): WebMcpInvocationResponse | undefined {
	if (
		!isRecord(value) ||
		typeof value.invocationId !== "string" ||
		!(["Canceled", "Completed", "Error"] as const).includes(value.status as never) ||
		(value.errorText !== undefined && typeof value.errorText !== "string")
	) {
		return undefined;
	}
	return {
		invocationId: value.invocationId,
		status: value.status as WebMcpInvocationResponse["status"],
		...(value.output === undefined ? {} : { output: value.output }),
		...(value.errorText === undefined ? {} : { errorText: value.errorText }),
		...(value.exception === undefined ? {} : { exception: value.exception }),
	};
}

function withDeadline(signal: AbortSignal) {
	return AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
