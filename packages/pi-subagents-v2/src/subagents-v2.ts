import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSubagentTools, type SubagentToolsDependencies } from "./tools.js";

export type SubagentsV2Dependencies = SubagentToolsDependencies;

export default function subagentsV2(
	pi: ExtensionAPI,
	dependencies: SubagentsV2Dependencies = {},
): void {
	const tools = registerSubagentTools(pi, dependencies);

	pi.on("session_shutdown", async () => {
		await tools.shutdown();
	});
}
