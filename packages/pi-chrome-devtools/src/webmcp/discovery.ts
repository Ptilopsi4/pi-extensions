import { getPage } from "../cdp-client.js";
import { type DevToolsPage, webMcpOperationIsCurrent } from "../runtime.js";
import {
	MAX_WEBMCP_TOOLS,
	normalizeWebMcpOutput,
	normalizeWebMcpTool,
	requireMatchingWebMcpTool,
	type WebMcpToolDescriptor,
	type WebMcpToolIdentity,
	webMcpErrorMessage,
} from "./policy.js";
import {
	connectWebMcpPage,
	disableWebMcp,
	enableWebMcp,
	invokeWebMcpTool,
	readWebMcpFrames,
	requireWebMcpDomain,
	type WebMcpFrame,
	type WebMcpProtocolTool,
} from "./protocol.js";

export interface WebMcpOperationIdentity {
	sessionGeneration: number;
	signal: AbortSignal;
	webMcpGeneration: number;
}

export interface WebMcpInvocationResult {
	invocationId: string;
	output: unknown;
	tool: WebMcpToolDescriptor;
}

export async function discoverWebMcpTools(page: DevToolsPage, operation: WebMcpOperationIdentity) {
	assertOperationCurrent(operation);
	await requireWebMcpDomain(operation.signal);
	assertOperationCurrent(operation);
	const client = await connectWebMcpPage(page, operation.signal);
	try {
		const tools = await readInventory(client, page, operation);
		await requireStablePage(page, operation);
		return tools;
	} finally {
		await disableWebMcp(client);
		client.close();
	}
}

export async function invokeDiscoveredWebMcpTool(
	page: DevToolsPage,
	expected: WebMcpToolIdentity,
	input: Record<string, unknown>,
	operation: WebMcpOperationIdentity,
): Promise<WebMcpInvocationResult> {
	assertOperationCurrent(operation);
	await requireWebMcpDomain(operation.signal);
	assertOperationCurrent(operation);
	const client = await connectWebMcpPage(page, operation.signal);
	try {
		const tools = await readInventory(client, page, operation);
		const tool = requireMatchingWebMcpTool(tools, expected);
		await requireStablePage(page, operation);
		assertOperationCurrent(operation);
		const response = await invokeWebMcpTool(
			client,
			{ frameId: tool.frameId, toolName: tool.name, input },
			operation.signal,
		);
		assertOperationCurrent(operation);
		if (response.status === "Canceled") {
			throw new DOMException("Chrome canceled the WebMCP tool invocation.", "AbortError");
		}
		if (response.status === "Error") {
			throw new Error(
				`WebMCP tool failed: ${webMcpErrorMessage(response.errorText ?? remoteExceptionText(response.exception))}`,
			);
		}
		return {
			invocationId: response.invocationId,
			output: normalizeWebMcpOutput(response.output ?? null),
			tool,
		};
	} finally {
		await disableWebMcp(client);
		client.close();
	}
}

async function readInventory(
	client: Awaited<ReturnType<typeof connectWebMcpPage>>,
	page: DevToolsPage,
	operation: WebMcpOperationIdentity,
) {
	const protocolTools = await enableWebMcp(client, operation.signal);
	assertOperationCurrent(operation);
	if (protocolTools.length > MAX_WEBMCP_TOOLS) {
		throw new Error(`WebMCP page exposes more than ${MAX_WEBMCP_TOOLS} tools.`);
	}
	const frames = await readWebMcpFrames(client, operation.signal);
	assertOperationCurrent(operation);
	return normalizeInventory(protocolTools, frames, page, operation);
}

function normalizeInventory(
	protocolTools: readonly WebMcpProtocolTool[],
	frames: readonly WebMcpFrame[],
	page: DevToolsPage,
	operation: WebMcpOperationIdentity,
) {
	const frameOrigins = new Map(frames.map((frame) => [frame.id, frameOrigin(frame)]));
	const tools = protocolTools.map((tool) => {
		const origin = frameOrigins.get(tool.frameId);
		if (!origin) {
			throw new Error(`WebMCP tool ${webMcpErrorMessage(tool.name)} belongs to an unknown frame.`);
		}
		return normalizeWebMcpTool(tool, {
			frameOrigin: origin,
			pageId: page.id,
			pageUrl: page.url,
			sessionGeneration: generationToken(operation),
		});
	});
	const identities = new Set<string>();
	for (const tool of tools) {
		const key = `${tool.frameId}\u0000${tool.name}`;
		if (identities.has(key)) {
			throw new Error(
				`WebMCP tool identity is duplicated: ${webMcpErrorMessage(tool.name)} in frame ${webMcpErrorMessage(tool.frameId)}.`,
			);
		}
		identities.add(key);
	}
	return tools;
}

async function requireStablePage(page: DevToolsPage, operation: WebMcpOperationIdentity) {
	const current = await getPage(page.id, { signal: operation.signal });
	assertOperationCurrent(operation);
	if (
		current.url !== page.url ||
		current.webSocketDebuggerUrl !== page.webSocketDebuggerUrl ||
		current.type !== page.type
	) {
		throw new Error("The Chrome page navigated or was replaced during the WebMCP operation.");
	}
}

function assertOperationCurrent(operation: WebMcpOperationIdentity) {
	operation.signal.throwIfAborted();
	if (!webMcpOperationIsCurrent(operation)) {
		throw new DOMException("The WebMCP operation became stale.", "AbortError");
	}
}

function generationToken(operation: WebMcpOperationIdentity) {
	return `${operation.sessionGeneration}:${operation.webMcpGeneration}`;
}

function frameOrigin(frame: WebMcpFrame) {
	if (frame.securityOrigin && frame.securityOrigin !== "://") return frame.securityOrigin;
	try {
		return new URL(frame.url).origin;
	} catch {
		throw new Error(
			`Chrome returned an invalid WebMCP frame URL: ${webMcpErrorMessage(frame.url)}`,
		);
	}
}

function remoteExceptionText(value: unknown) {
	if (typeof value === "object" && value !== null) {
		const exception = value as { description?: unknown; value?: unknown };
		if (typeof exception.description === "string") return exception.description;
		if (typeof exception.value === "string") return exception.value;
	}
	return "The page reported an unknown tool error.";
}
