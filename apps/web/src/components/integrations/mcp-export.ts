import type { McpServerRow } from "@/utils/api-types";

// Config generators for exporting one of the user's MCP servers into the
// formats each coding agent expects. Stored auth tokens are NEVER exposed
// (only last4 is known client-side), so a server with auth exports a
// placeholder the user replaces with their own token.

export type ExportTargetId = "claude-code" | "codex" | "opencode";

export interface ExportTarget {
	id: ExportTargetId;
	label: string;
}

export const EXPORT_TARGETS: ExportTarget[] = [
	{ id: "claude-code", label: "Claude Code" },
	{ id: "codex", label: "Codex" },
	{ id: "opencode", label: "opencode" },
];

const TOKEN_PLACEHOLDER = "<YOUR_BEARER_TOKEN>";
const SLUG_RE = /[^a-z0-9]+/g;
const EDGE_DASH_RE = /^-+|-+$/g;

export interface ExportResult {
	/** File contents (JSON or TOML). */
	content: string;
	/** Download filename. */
	filename: string;
	/** Step-by-step setup instructions shown in the modal. */
	howto: string[];
	/** Fenced language for the modal's code preview. */
	language: "json" | "toml";
	/** True when the config carries a token placeholder to fill in. */
	needsToken: boolean;
}

function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(SLUG_RE, "-")
		.replace(EDGE_DASH_RE, "");
	return slug || "mcp-server";
}

function authHeaders(hasAuth: boolean): Record<string, string> | null {
	return hasAuth ? { Authorization: `Bearer ${TOKEN_PLACEHOLDER}` } : null;
}

function claudeCode(name: string, url: string, hasAuth: boolean): ExportResult {
	const slug = slugify(name);
	const headers = authHeaders(hasAuth);
	const entry: Record<string, unknown> = { type: "http", url };
	if (headers) {
		entry.headers = headers;
	}
	return {
		filename: ".mcp.json",
		content: `${JSON.stringify({ mcpServers: { [slug]: entry } }, null, 2)}\n`,
		language: "json",
		needsToken: hasAuth,
		howto: [
			"Save this as `.mcp.json` in your project root (or merge the `mcpServers` entry into an existing one).",
			`Or run: claude mcp add --transport http ${slug} ${url}${hasAuth ? ' --header "Authorization: Bearer <token>"' : ""}`,
			"Restart Claude Code, then run `/mcp` to confirm the server connected.",
		],
	};
}

function codex(name: string, url: string, hasAuth: boolean): ExportResult {
	const slug = slugify(name);
	const lines = [`[mcp_servers.${slug}]`, `url = "${url}"`];
	if (hasAuth) {
		lines.push(
			`http_headers = { "Authorization" = "Bearer ${TOKEN_PLACEHOLDER}" }`
		);
	}
	return {
		filename: `codex-${slug}.toml`,
		content: `${lines.join("\n")}\n`,
		language: "toml",
		needsToken: hasAuth,
		howto: [
			"Append this block to `~/.codex/config.toml` (create the file if it doesn't exist).",
			"Start `codex`; the server's tools become available in your session.",
		],
	};
}

function opencode(name: string, url: string, hasAuth: boolean): ExportResult {
	const slug = slugify(name);
	const headers = authHeaders(hasAuth);
	const entry: Record<string, unknown> = { type: "remote", url, enabled: true };
	if (headers) {
		entry.headers = headers;
	}
	return {
		filename: "opencode.json",
		content: `${JSON.stringify({ mcp: { [slug]: entry } }, null, 2)}\n`,
		language: "json",
		needsToken: hasAuth,
		howto: [
			"Merge the `mcp` entry into your `opencode.json` (project root) or `~/.config/opencode/opencode.json`.",
			"Restart opencode; the server appears under its tools.",
		],
	};
}

export function buildExport(
	target: ExportTargetId,
	server: Pick<McpServerRow, "name" | "url" | "authLast4">
): ExportResult {
	const hasAuth = server.authLast4 !== null;
	if (target === "claude-code") {
		return claudeCode(server.name, server.url, hasAuth);
	}
	if (target === "codex") {
		return codex(server.name, server.url, hasAuth);
	}
	return opencode(server.name, server.url, hasAuth);
}
