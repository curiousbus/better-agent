import { describe, expect, it } from "vitest";

interface RpcBody {
	error?: { code: number; message: string };
	result?: {
		capabilities?: { tools?: Record<string, unknown> };
		content?: { text: string; type: string }[];
		isError?: boolean;
		serverInfo?: unknown;
		tools?: { name: string }[];
	};
}

const asRpc = (value: unknown): RpcBody => value as RpcBody;

import { buildApp } from "./app";
import { PROTOCOL_VERSION, SERVER_INFO } from "./mcp-server";

const app = buildApp();

function rpc(method: string, params?: Record<string, unknown>, id = 1) {
	return app.request("/", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
	});
}

describe("mcp worker", () => {
	it("answers the health probe", async () => {
		const res = await app.request("/");
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("OK");
	});

	it("completes the initialize handshake", async () => {
		const res = await rpc("initialize", {
			protocolVersion: PROTOCOL_VERSION,
			capabilities: {},
			clientInfo: { name: "test", version: "0" },
		});
		expect(res.status).toBe(200);
		const body = asRpc(await res.json());
		expect(body.result?.serverInfo).toEqual(SERVER_INFO);
		expect(body.result?.capabilities?.tools).toEqual({});
	});

	it("accepts the initialized notification without a body", async () => {
		const res = await app.request("/", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				jsonrpc: "2.0",
				method: "notifications/initialized",
			}),
		});
		expect(res.status).toBe(202);
	});

	it("lists and calls the mock tool", async () => {
		const list = asRpc(await (await rpc("tools/list")).json());
		expect(list.result?.tools?.[0]?.name).toBe("get_mock_data");

		const call = asRpc(
			await (
				await rpc("tools/call", { name: "get_mock_data", arguments: {} })
			).json()
		);
		expect(call.result?.isError).toBe(false);
		expect(
			JSON.parse(call.result?.content?.[0]?.text ?? "{}").items
		).toHaveLength(2);
	});

	it("flags unknown tools as tool errors, unknown methods as rpc errors", async () => {
		const badTool = asRpc(
			await (await rpc("tools/call", { name: "nope", arguments: {} })).json()
		);
		expect(badTool.result?.isError).toBe(true);

		const badMethod = asRpc(await (await rpc("bogus/method")).json());
		expect(badMethod.error?.code).toBe(-32_601);
	});
});
