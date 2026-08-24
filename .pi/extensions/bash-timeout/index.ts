import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";

export const MAX_BASH_TIMEOUT_SECONDS = 300;

export default function bashTimeout(pi: ExtensionAPI): void {
	pi.on("tool_call", (event) => {
		if (!isToolCallEventType("bash", event)) return;

		event.input.timeout = Math.min(
			event.input.timeout ?? MAX_BASH_TIMEOUT_SECONDS,
			MAX_BASH_TIMEOUT_SECONDS,
		);
	});
}
