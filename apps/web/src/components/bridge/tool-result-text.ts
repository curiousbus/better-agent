/** Normalizes a tool result of unknown shape into a renderable string. A raw
 * bridge tool `output` (or a persisted `ToolInvocation.result`) shows up in
 * three shapes in practice, plus anything else a future agent might send:
 *  - a plain string — already renderable, passed through as-is;
 *  - the MCP content envelope `{ content: [{ type: "text", text }] }`;
 *  - opencode's content-array `[{ type: "content", content: { type: "text",
 *    text } }]` — an array of envelopes rather than a single one.
 * Anything else falls back to a pretty-printed JSON dump so a result is
 * NEVER blank just because it doesn't match a known shape. */

interface McpTextContent {
	text?: string;
	type: string;
}

interface McpEnvelope {
	content: McpTextContent[];
}

interface OpenCodeContentPart {
	content: McpTextContent;
	type: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isMcpEnvelope(value: unknown): value is McpEnvelope {
	if (!isRecord(value)) {
		return false;
	}
	return Array.isArray(value.content);
}

function isOpenCodeContentPart(value: unknown): value is OpenCodeContentPart {
	if (!isRecord(value) || value.type !== "content") {
		return false;
	}
	return isRecord(value.content);
}

function isOpenCodeContentArray(
	value: unknown
): value is OpenCodeContentPart[] {
	return Array.isArray(value) && value.every(isOpenCodeContentPart);
}

function joinTexts(texts: Array<string | undefined>): string {
	return texts
		.filter((text): text is string => typeof text === "string" && text !== "")
		.join("\n\n");
}

const JSON_INDENT_SPACES = 2;

function stringifyFallback(value: unknown): string {
	try {
		return JSON.stringify(value, null, JSON_INDENT_SPACES) ?? "";
	} catch {
		return String(value);
	}
}

/** Flatten any of the shapes above into plain text. Never returns `undefined`
 * — an absent result flattens to the empty string, not the literal text
 * "undefined". */
export function flattenToolResult(result: unknown): string {
	if (result === undefined) {
		return "";
	}
	if (typeof result === "string") {
		return result;
	}
	if (isOpenCodeContentArray(result)) {
		return joinTexts(result.map((part) => part.content.text));
	}
	if (isMcpEnvelope(result)) {
		return joinTexts(result.content.map((part) => part.text));
	}
	return stringifyFallback(result);
}
