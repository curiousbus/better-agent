import { describe, expect, it } from "vitest";
import { buildExport } from "./mcp-export";

const WITH_AUTH = {
	name: "X API",
	url: "https://api.x.com/mcp",
	authLast4: "cdef",
};
const OPEN = {
	name: "Docs Server",
	url: "https://docs.x.com/mcp",
	authLast4: null,
};

describe("buildExport", () => {
	it("Claude Code: mcpServers http entry, headers only when authed", () => {
		const authed = buildExport("claude-code", WITH_AUTH);
		expect(authed.filename).toBe(".mcp.json");
		const parsed = JSON.parse(authed.content);
		expect(parsed.mcpServers["x-api"]).toMatchObject({
			type: "http",
			url: WITH_AUTH.url,
			headers: { Authorization: "Bearer <YOUR_BEARER_TOKEN>" },
		});
		expect(authed.needsToken).toBe(true);

		const open = buildExport("claude-code", OPEN);
		expect(
			JSON.parse(open.content).mcpServers["docs-server"].headers
		).toBeUndefined();
		expect(open.needsToken).toBe(false);
	});

	it("Codex: TOML mcp_servers block with http_headers when authed", () => {
		const authed = buildExport("codex", WITH_AUTH);
		expect(authed.language).toBe("toml");
		expect(authed.content).toContain("[mcp_servers.x-api]");
		expect(authed.content).toContain('url = "https://api.x.com/mcp"');
		expect(authed.content).toContain("http_headers");

		const open = buildExport("codex", OPEN);
		expect(open.content).not.toContain("http_headers");
	});

	it("opencode: remote mcp entry", () => {
		const authed = buildExport("opencode", WITH_AUTH);
		const parsed = JSON.parse(authed.content);
		expect(parsed.mcp["x-api"]).toMatchObject({
			type: "remote",
			url: WITH_AUTH.url,
			enabled: true,
		});
	});

	it("slugifies names without alphanumerics to a fallback", () => {
		const result = buildExport("claude-code", {
			name: "!!!",
			url: "https://x/mcp",
			authLast4: null,
		});
		expect(JSON.parse(result.content).mcpServers["mcp-server"]).toBeDefined();
	});
});
