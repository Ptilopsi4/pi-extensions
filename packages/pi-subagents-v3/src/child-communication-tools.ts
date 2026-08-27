import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import {
	MAX_IDENTIFIER_LENGTH,
	MAX_MESSAGE_BYTES,
	sanitizeTerminalText,
	validateMessage,
} from "./message-broker.js";

export const CHILD_COMMUNICATION_TOOL_NAMES = ["subagent-ask", "subagent-wait"] as const;

const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;

const AskParameters = Type.Object(
	{
		message: Type.String({
			description: "Self-contained question for the main agent. Maximum 50 KiB.",
			minLength: 1,
			maxLength: MAX_MESSAGE_BYTES,
		}),
	},
	{ additionalProperties: false },
);

const WaitParameters = Type.Object(
	{
		requestId: Type.String({
			description: "Request ID returned by subagent-ask.",
			minLength: 1,
			maxLength: MAX_IDENTIFIER_LENGTH,
		}),
		timeout: Type.Optional(
			Type.Number({ description: "Timeout in seconds (optional, no default timeout)" }),
		),
	},
	{ additionalProperties: false },
);

type WaitArguments = Static<typeof WaitParameters>;

export interface ChildCommunicationClient {
	ask(message: string, signal?: AbortSignal): Promise<string>;
	wait(requestId: string, timeoutMs: number | undefined, signal?: AbortSignal): Promise<string>;
}

export function createChildCommunicationExtension(
	client: ChildCommunicationClient,
): ExtensionFactory {
	return (pi) => {
		pi.registerTool({
			name: "subagent-ask",
			label: "Subagent · Ask Main Agent",
			description:
				"Use subagent-ask to send one bounded, self-contained question to the main agent. It returns a request ID immediately; call subagent-wait with that ID to receive the plain-text reply.",
			promptSnippet: "Use subagent-ask to ask the main agent one necessary question",
			parameters: AskParameters,
			async execute(_toolCallId, params, signal) {
				validateMessage(params.message, "Subagent question");
				const requestId = await client.ask(params.message, signal);
				return {
					content: [{ type: "text" as const, text: requestId }],
					details: { requestId },
				};
			},
		});

		pi.registerTool({
			name: "subagent-wait",
			label: "Subagent · Wait for Main Agent",
			description:
				"Use subagent-wait with a request ID from subagent-ask to wait for the main agent's plain-text reply. A timeout or caller cancellation stops only this wait and does not cancel the request.",
			promptSnippet: "Use subagent-wait to receive a requested main-agent reply",
			parameters: WaitParameters,
			prepareArguments: prepareWaitArguments,
			async execute(_toolCallId, params, signal) {
				const requestId = requiredIdentifier(params.requestId, "requestId");
				const response = await client.wait(requestId, resolveTimeoutMs(params.timeout), signal);
				return {
					content: [{ type: "text" as const, text: sanitizeTerminalText(response) }],
					details: { requestId },
				};
			},
		});
	};
}

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
	if (timeout === undefined) return undefined;
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error("Invalid timeout: must be a finite number of seconds");
	}
	const timeoutMs = timeout * 1000;
	if (timeoutMs > MAX_TIMEOUT_MS) {
		throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
	}
	return timeoutMs;
}

function prepareWaitArguments(args: unknown): WaitArguments {
	if (!args || typeof args !== "object") return args as WaitArguments;
	if (!Object.hasOwn(args, "timeoutMs")) return args as WaitArguments;
	const { timeoutMs, ...prepared } = args as Record<string, unknown>;
	if (prepared.timeout === undefined && typeof timeoutMs === "number") {
		return { ...prepared, timeout: timeoutMs / 1000 } as WaitArguments;
	}
	return prepared as WaitArguments;
}

function requiredIdentifier(value: unknown, field: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`Subagent ${field} is required.`);
	const identifier = value.trim();
	if (
		identifier.length > MAX_IDENTIFIER_LENGTH ||
		[...identifier].some((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
		})
	) {
		throw new Error(`Subagent ${field} is invalid.`);
	}
	return identifier;
}
