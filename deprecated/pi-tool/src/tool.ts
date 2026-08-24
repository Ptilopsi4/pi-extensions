import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const COMMAND_NAME = "tool";

export default function toolExtension(pi: ExtensionAPI) {
	let generation = 0;
	let sessionController = new AbortController();

	const replaceSessionOwner = () => {
		sessionController.abort(new DOMException("Tool catalog session replaced", "AbortError"));
		sessionController = new AbortController();
		generation += 1;
	};

	pi.on("session_start", () => {
		replaceSessionOwner();
	});

	pi.on("session_shutdown", () => {
		sessionController.abort(new DOMException("Tool catalog session ended", "AbortError"));
	});

	pi.registerCommand(COMMAND_NAME, {
		description: "Browse configured tools and inspect their metadata",
		handler: async (args, ctx) => {
			if (args.trim()) throw new Error("/tool does not accept arguments.");
			if (!ctx.hasUI || (ctx.mode !== "tui" && ctx.mode !== "rpc")) {
				throw new Error("/tool requires TUI or RPC mode.");
			}

			const commandGeneration = generation;
			const signal = sessionController.signal;
			const isCurrent = () => commandGeneration === generation && !signal.aborted;
			const [{ runMenu }, { createToolCatalog, createToolMenu }] = await Promise.all([
				import("@narumitw/pi-tui-kit"),
				import("./tool-catalog.js"),
			]);
			if (!isCurrent()) return;
			const catalog = createToolCatalog(
				pi.getAllTools(),
				pi.getActiveTools(),
				ctx.getSystemPromptOptions().toolSnippets ?? {},
			);
			const onError = (errorCtx: typeof ctx) => {
				if (isCurrent()) errorCtx.ui.notify("The tool catalog could not be displayed.", "error");
			};
			const onUnsupportedMode = (_unsupportedCtx: typeof ctx, mode: typeof ctx.mode) => {
				throw new Error(`/tool is unavailable in ${mode} mode; use TUI or RPC mode.`);
			};

			await runMenu(ctx, createToolMenu(catalog), {
				getState: () => undefined,
				signal,
				isCurrent,
				onError,
				onUnsupportedMode,
			});
		},
	});
}
