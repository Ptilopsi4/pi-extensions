import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getPage, resolvePage, textResult } from "../cdp-client.js";
import {
	beginWebMcpOperation,
	currentWebMcpGeneration,
	state,
	webMcpOperationIsCurrent,
	webMcpSessionSignal,
} from "../runtime.js";
import { discoverWebMcpTools, invokeDiscoveredWebMcpTool } from "./discovery.js";
import {
	boundedWebMcpDiscovery,
	boundedWebMcpJson,
	normalizeWebMcpInput,
	requireMatchingWebMcpTool,
	sanitizeWebMcpDisplay,
	validateWebMcpInput,
	type WebMcpToolIdentity,
	webMcpConfirmationMessage,
	webMcpErrorMessage,
	webMcpIdentity,
} from "./policy.js";

interface ListInput {
	pageId?: string;
}

interface CallInput extends Omit<WebMcpToolIdentity, "name"> {
	input: Record<string, unknown>;
	toolName: string;
}

export async function executeWebMcpListTool(
	params: ListInput,
	toolSignal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	requireWebMcpEnabled();
	const preflightGeneration = currentWebMcpGeneration(ctx.sessionManager);
	const preflightSignal = combinedSignal(ctx.sessionManager, toolSignal);
	preflightSignal.throwIfAborted();
	const page = await resolvePage(params.pageId, {
		signal: preflightSignal,
		webMcpOwner: ctx.sessionManager,
	});
	preflightSignal.throwIfAborted();
	requireCurrentPreflight(ctx.sessionManager, preflightGeneration);
	const operation = beginWebMcpOperation(ctx.sessionManager, toolSignal);
	try {
		const tools = await discoverWebMcpTools(page, operation);
		assertCurrent(operation);
		const published = boundedWebMcpDiscovery(
			{ id: page.id, title: page.title, url: page.url },
			tools,
		);
		return textResult(published.text, {
			page: { id: page.id, url: page.url },
			toolCount: tools.length,
			publishedToolCount: published.included.length,
			truncated: published.truncated,
			identities: published.included.map(webMcpIdentity),
		});
	} catch (error) {
		throw safeToolError(error);
	} finally {
		operation.dispose();
	}
}

export async function executeWebMcpCallTool(
	params: CallInput,
	toolSignal: AbortSignal | undefined,
	ctx: ExtensionContext,
) {
	requireWebMcpEnabled();
	if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
		throw new Error(
			"chrome_devtools_webmcp_call_tool requires observable confirmation in TUI or RPC mode and is unavailable in print or JSON mode.",
		);
	}
	const input = normalizeWebMcpInput(params.input);
	const expected = expectedIdentity(params);
	const preflightGeneration = currentWebMcpGeneration(ctx.sessionManager);
	const preflightSignal = combinedSignal(ctx.sessionManager, toolSignal);
	preflightSignal.throwIfAborted();
	const page = await getPage(params.pageId, {
		signal: preflightSignal,
		webMcpOwner: ctx.sessionManager,
	});
	preflightSignal.throwIfAborted();
	requireCurrentPreflight(ctx.sessionManager, preflightGeneration);
	const operation = beginWebMcpOperation(ctx.sessionManager, toolSignal);
	try {
		const discovered = await discoverWebMcpTools(page, operation);
		const current = requireMatchingWebMcpTool(discovered, expected);
		const validatedInput = validateWebMcpInput(current.inputSchema, input);
		assertCurrent(operation);
		const confirmed = await ctx.ui.confirm(
			`Allow WebMCP tool: ${sanitizeWebMcpDisplay(current.name, 256)}`,
			webMcpConfirmationMessage(current, validatedInput, usesManagedProfile()),
			{ signal: operation.signal },
		);
		assertCurrent(operation);
		if (!confirmed) {
			throw new DOMException("WebMCP tool call cancelled by the user.", "AbortError");
		}
		const invocation = await invokeDiscoveredWebMcpTool(page, expected, validatedInput, operation);
		assertCurrent(operation);
		const published = boundedWebMcpJson({
			status: "completed",
			tool: webMcpIdentity(invocation.tool),
			output: invocation.output,
		});
		return textResult(published.text, {
			invocationId: invocation.invocationId,
			tool: webMcpIdentity(invocation.tool),
			truncated: published.truncated,
			output: published.text,
		});
	} catch (error) {
		throw safeToolError(error);
	} finally {
		operation.dispose();
	}
}

function requireWebMcpEnabled() {
	if (!state.webMcpEnabled) {
		throw new Error(
			"WebMCP is disabled. Enable the experimental user setting in /chrome-devtools settings, then make the WebMCP gateway tools available.",
		);
	}
}

function combinedSignal(owner: object, toolSignal: AbortSignal | undefined) {
	const sessionSignal = webMcpSessionSignal(owner);
	return toolSignal ? AbortSignal.any([toolSignal, sessionSignal]) : sessionSignal;
}

function requireCurrentPreflight(owner: object, generation: number) {
	requireWebMcpEnabled();
	if (generation !== currentWebMcpGeneration(owner)) {
		throw new DOMException(
			"The WebMCP operation became stale during page resolution.",
			"AbortError",
		);
	}
}

function expectedIdentity(params: CallInput): WebMcpToolIdentity {
	return {
		sessionGeneration: params.sessionGeneration,
		pageId: params.pageId,
		documentId: params.documentId,
		frameId: params.frameId,
		frameOrigin: params.frameOrigin,
		name: params.toolName,
		schemaDigest: params.schemaDigest,
	};
}

function assertCurrent(operation: ReturnType<typeof beginWebMcpOperation>) {
	operation.signal.throwIfAborted();
	if (!webMcpOperationIsCurrent(operation)) {
		throw new DOMException("The WebMCP operation became stale.", "AbortError");
	}
}

function usesManagedProfile() {
	return Boolean(state.managedBrowser?.ready && !state.managedBrowser.exited);
}

function safeToolError(error: unknown) {
	const message = webMcpErrorMessage(error);
	if (error instanceof DOMException && error.name === "AbortError") {
		return new DOMException(message, "AbortError");
	}
	return new Error(message);
}
