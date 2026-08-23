import type { Api, Model } from "@earendil-works/pi-ai";
import { hasApi } from "@earendil-works/pi-ai";

export function isCodexRemoteCompactionModel(
	model: Model<Api> | undefined,
): model is Model<"openai-codex-responses"> {
	return model !== undefined && hasApi(model, "openai-codex-responses");
}
