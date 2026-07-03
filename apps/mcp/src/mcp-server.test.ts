import { expect, it } from "vitest";
import { buildApp } from "./app";
import { PROTOCOL_VERSION, SERVER_INFO } from "./mcp-server";

const ACCEPTED_STATUS = 202;
const METHOD_NOT_FOUND = -32_601;

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
const app = buildApp();

function rpc(
	method: string,
	params?: Record<string, unknown>,
	authToken?: string
) {
	const headers: Record<string, string> = {
		"content-type": "application/json",
	};
	if (authToken) {
		headers.authorization = `Bearer ${authToken}`;
	}
	return app.request("/", {
		method: "POST",
		headers,
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
}

it("answers the health probe", async () => {
	const res = await app.request("/");
	expect(res.status).toBe(200);
	expect(await res.text()).toContain("OK");
});

it("completes the initialize handshake", async () => {
	const body = asRpc(
		await (
			await rpc("initialize", {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {},
				clientInfo: { name: "test", version: "0" },
			})
		).json()
	);
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
	expect(res.status).toBe(ACCEPTED_STATUS);
});

it("lists all the X tools", async () => {
	const body = asRpc(await (await rpc("tools/list")).json());
	const names = (body.result?.tools ?? []).map((t) => t.name);
	expect(names).toContain("x_search_users");
	expect(names).toContain("x_search_tweets");
	expect(names).toContain("x_user_tweets");
	expect(names).toContain("x_user_replies");
	expect(names).toContain("x_user_media");
	expect(names).toContain("x_user_likes");
	expect(names).toContain("x_followers");
	expect(names).toContain("x_following");
	expect(names).toContain("x_tweet_thread");
	expect(names.length).toBe(9);
});

it("returns a tool error when no auth_token is provided", async () => {
	const body = asRpc(
		await (
			await rpc("tools/call", {
				name: "x_search_users",
				arguments: { screen_name: "jack" },
			})
		).json()
	);
	expect(body.result?.isError).toBe(true);
	expect(body.result?.content?.[0]?.text).toContain("auth_token");
});

it("flags unknown tools and unknown methods", async () => {
	const badTool = asRpc(
		await (
			await rpc(
				"tools/call",
				{ name: "nope", arguments: {} },
				"dummy-token-value-1234567890"
			)
		).json()
	);
	expect(badTool.result?.isError).toBe(true);

	const badMethod = asRpc(await (await rpc("bogus/method")).json());
	expect(badMethod.error?.code).toBe(METHOD_NOT_FOUND);
});
