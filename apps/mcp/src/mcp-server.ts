// Minimal MCP server core (Streamable HTTP, stateless JSON mode): handles the
// protocol handshake and serves ONE mock tool. Real capabilities land here
// once the requirements are settled — the transport/plumbing won't change.

export const PROTOCOL_VERSION = "2025-06-18";
export const SERVER_INFO = { name: "better-agent-mcp", version: "0.1.0" };

interface JsonRpcRequest {
	id?: number | string | null;
	jsonrpc: "2.0";
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	error?: { code: number; message: string };
	id: number | string | null;
	jsonrpc: "2.0";
	result?: unknown;
}

const METHOD_NOT_FOUND = -32_600 - 1; // -32601 per JSON-RPC spec

const MOCK_TOOL = {
	name: "get_mock_data",
	description:
		"Returns a small static sample dataset. Placeholder tool while the real " +
		"MCP capabilities of this server are being specified.",
	inputSchema: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
};

const MOCK_DATA = {
	items: [
		{ id: 1, name: "alpha", value: 42 },
		{ id: 2, name: "beta", value: 7 },
	],
	source: SERVER_INFO.name,
};

function ok(id: JsonRpcResponse["id"], result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

function callTool(id: JsonRpcResponse["id"], name: unknown): JsonRpcResponse {
	if (name !== MOCK_TOOL.name) {
		return ok(id, {
			content: [{ type: "text", text: `Unknown tool: ${String(name)}` }],
			isError: true,
		});
	}
	return ok(id, {
		content: [{ type: "text", text: JSON.stringify(MOCK_DATA) }],
		isError: false,
	});
}

/** Handle one JSON-RPC message; null = notification (no response body). */
export function handleMessage(message: JsonRpcRequest): JsonRpcResponse | null {
	const id = message.id ?? null;
	if (message.method.startsWith("notifications/")) {
		return null;
	}
	switch (message.method) {
		case "initialize":
			return ok(id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: { tools: {} },
				serverInfo: SERVER_INFO,
			});
		case "ping":
			return ok(id, {});
		case "tools/list":
			return ok(id, { tools: [MOCK_TOOL] });
		case "tools/call":
			return callTool(id, message.params?.name);
		default:
			return {
				jsonrpc: "2.0",
				id,
				error: {
					code: METHOD_NOT_FOUND,
					message: `Unknown method: ${message.method}`,
				},
			};
	}
}
