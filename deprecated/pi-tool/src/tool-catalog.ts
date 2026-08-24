import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { MenuDefinition } from "@narumitw/pi-tui-kit";

export interface ToolCatalogState {
	tools: ReturnType<ExtensionAPI["getAllTools"]>;
	activeToolNames: readonly string[];
	toolSnippets: Readonly<Record<string, string>>;
}

export interface ToolCatalogItem {
	id: string;
	label: string;
	statusText: "active" | "inactive";
	description: string;
	searchText: string;
	detailContent: string;
}

export interface ToolCatalog {
	title: string;
	items: ToolCatalogItem[];
}

export function createToolCatalog(
	tools: ToolCatalogState["tools"],
	activeToolNames: readonly string[],
	toolSnippets: ToolCatalogState["toolSnippets"],
): ToolCatalog {
	const active = new Set(activeToolNames);
	const items = [...tools]
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((tool): ToolCatalogItem => {
			const parameterSchema = JSON.stringify(tool.parameters, null, 2) ?? "Unavailable";
			const guidelines = tool.promptGuidelines ?? [];
			const effectivePromptSnippet = toolSnippets[tool.name];
			return {
				id: tool.name,
				label: tool.name,
				statusText: active.has(tool.name) ? "active" : "inactive",
				description: tool.description,
				searchText: [
					tool.name,
					tool.description,
					tool.sourceInfo.source,
					tool.sourceInfo.scope,
					tool.sourceInfo.origin,
					tool.sourceInfo.path,
					tool.sourceInfo.baseDir,
					effectivePromptSnippet,
					...guidelines,
					parameterSchema,
				]
					.filter(Boolean)
					.join(" "),
				detailContent: [
					`Status: ${active.has(tool.name) ? "active" : "inactive"}`,
					tool.description,
					`Source: ${tool.sourceInfo.source}`,
					`Scope: ${tool.sourceInfo.scope}`,
					`Origin: ${tool.sourceInfo.origin}`,
					`Path: ${tool.sourceInfo.path}`,
					...(tool.sourceInfo.baseDir ? [`Base directory: ${tool.sourceInfo.baseDir}`] : []),
					"",
					"Effective prompt snippet",
					effectivePromptSnippet ?? "None in the current system prompt.",
					"",
					"Parameter schema",
					parameterSchema,
					"",
					"Prompt guidelines",
					...(guidelines.length > 0 ? guidelines.map((guideline) => `• ${guideline}`) : ["None"]),
				].join("\n"),
			};
		});
	const activeCount = tools.reduce((count, tool) => count + Number(active.has(tool.name)), 0);
	return { title: `Tools · ${activeCount}/${tools.length} active`, items };
}

export function createToolMenu(catalog: ToolCatalog): MenuDefinition<undefined, "tools", never> {
	return {
		start: "tools",
		screens: {
			tools: () => ({
				kind: "browse",
				title: catalog.title,
				items: catalog.items.map((item) => ({
					id: item.id,
					label: item.label,
					statusText: item.statusText,
					description: item.description,
					searchText: item.searchText,
					detailDocument: {
						content: item.detailContent,
						format: { kind: "text" },
					},
				})),
				viewportSize: "adaptive",
				hint: "close",
			}),
		},
		actions: {},
	};
}
