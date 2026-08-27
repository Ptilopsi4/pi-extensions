import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@earendil-works/pi-coding-agent";

export const DEFAULT_MAX_OUTPUT_LINES = DEFAULT_MAX_LINES;
export const TRUNCATION_MARKER = "\n… [truncated by pi-subagents]";
export const TAIL_TRUNCATION_MARKER = "… [truncated by pi-subagents]\n";

export interface BoundedText {
	text: string;
	truncated: boolean;
	originalBytes: number;
}

export function safeTerminalText(value: string): string {
	return value
		.replace(
			// biome-ignore lint/suspicious/noControlCharactersInRegex: Strip untrusted terminal controls while preserving LF and tab.
			/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu,
			"",
		)
		.replace(/\r/gu, "");
}

export function safeTerminalLine(value: string, maxBytes = 2 * 1024): string {
	const singleLine = safeTerminalText(redactPrivateText(value)).replace(/\s+/gu, " ").trim();
	return truncateUtf8(singleLine, maxBytes).text.replace(/\s+/gu, " ").trim();
}

export function boundText(
	value: string,
	maxBytes = DEFAULT_MAX_BYTES,
	maxLines = DEFAULT_MAX_OUTPUT_LINES,
): { text: string; truncated: boolean } {
	const safe = safeTerminalText(value);
	const lines = safe.split("\n");
	const lineBounded =
		lines.length > maxLines
			? `${lines.slice(0, Math.max(0, maxLines - 1)).join("\n")}${TRUNCATION_MARKER}`
			: safe;
	const bounded = truncateUtf8(lineBounded, maxBytes);
	return { text: bounded.text, truncated: lines.length > maxLines || bounded.truncated };
}

export function truncateUtf8(text: string, maxBytes: number): BoundedText {
	const limit = normalizeByteLimit(maxBytes);
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= limit) return { text, truncated: false, originalBytes: bytes.length };
	if (limit === 0) return { text: "", truncated: true, originalBytes: bytes.length };
	const marker = Buffer.from(TRUNCATION_MARKER, "utf8");
	if (marker.length >= limit) {
		return {
			text: bytes.subarray(0, limit).toString("utf8").replace(/�+$/gu, ""),
			truncated: true,
			originalBytes: bytes.length,
		};
	}
	return {
		text: `${bytes
			.subarray(0, limit - marker.length)
			.toString("utf8")
			.replace(/�+$/gu, "")}${TRUNCATION_MARKER}`,
		truncated: true,
		originalBytes: bytes.length,
	};
}

export function truncateUtf8Tail(text: string, maxBytes: number): BoundedText {
	const limit = normalizeByteLimit(maxBytes);
	const bytes = Buffer.from(text, "utf8");
	if (bytes.length <= limit) return { text, truncated: false, originalBytes: bytes.length };
	if (limit === 0) return { text: "", truncated: true, originalBytes: bytes.length };
	const marker = Buffer.from(TAIL_TRUNCATION_MARKER, "utf8");
	if (marker.length >= limit) {
		return {
			text: bytes
				.subarray(bytes.length - limit)
				.toString("utf8")
				.replace(/^�+/gu, ""),
			truncated: true,
			originalBytes: bytes.length,
		};
	}
	return {
		text: `${TAIL_TRUNCATION_MARKER}${bytes
			.subarray(bytes.length - (limit - marker.length))
			.toString("utf8")
			.replace(/^�+/gu, "")}`,
		truncated: true,
		originalBytes: bytes.length,
	};
}

function normalizeByteLimit(maxBytes: number): number {
	if (maxBytes === Number.POSITIVE_INFINITY) return Number.MAX_SAFE_INTEGER;
	if (!Number.isFinite(maxBytes)) return 0;
	return Math.max(0, Math.floor(maxBytes));
}

function redactPrivateText(text: string): string {
	const tagPattern = /<\/?private>/giu;
	let redacted = "";
	let cursor = 0;
	let depth = 0;
	for (const match of text.matchAll(tagPattern)) {
		const tag = match[0].toLowerCase();
		const index = match.index ?? cursor;
		if (depth === 0) redacted += text.slice(cursor, index);
		if (tag === "<private>") {
			if (depth === 0) redacted += "[private content omitted]";
			depth += 1;
		} else if (depth > 0) {
			depth -= 1;
		} else {
			redacted += match[0];
		}
		cursor = index + match[0].length;
	}
	if (depth === 0) redacted += text.slice(cursor);
	return redacted
		.split("\n")
		.filter((line) => !line.includes("[subagent-private]"))
		.join("\n");
}
