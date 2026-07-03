import { createXClient } from "./x/x-client";
import { XAuthError, XRateLimitError } from "./x/x-errors";
import { searchTweets, searchUsers, userTweets } from "./x/x-tools-impl";

// MCP server core (Streamable HTTP, stateless JSON mode): handshake + a set of
// X (Twitter) tools. Each request carries the user's X auth_token as the bearer
// token (see app.ts); the server keeps no per-user state.

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

export interface RequestContext {
	authToken: string | null;
}

const METHOD_NOT_FOUND = -32_601;
const DEFAULT_LIMIT_HINT = 5;

const LIMIT_PROP = {
	type: "number",
	description: `How many tweets to return (default ${DEFAULT_LIMIT_HINT}, max 20).`,
};

const HANDLE_PROP = {
	type: "string",
	description: "The user's @handle without the leading @.",
};

const TOOLS = [
	{
		name: "x_search_users",
		description:
			"Look up an X (Twitter) user by their @handle. Returns the profile: " +
			"display name, bio, follower/following/tweet counts, verified flag, " +
			"avatar and banner URLs.",
		inputSchema: {
			type: "object",
			properties: { screen_name: HANDLE_PROP },
			required: ["screen_name"],
			additionalProperties: false,
		},
	},
	{
		name: "x_search_tweets",
		description:
			"Search recent X (Twitter) posts matching a query. Returns tweets with " +
			"author, text, media, and like/retweet/reply/view counts.",
		inputSchema: {
			type: "object",
			properties: {
				query: { type: "string", description: "The search query." },
				limit: LIMIT_PROP,
			},
			required: ["query"],
			additionalProperties: false,
		},
	},
	{
		name: "x_user_tweets",
		description:
			"Fetch the most recent tweets posted by a specific X (Twitter) user, " +
			"given their @handle.",
		inputSchema: {
			type: "object",
			properties: { screen_name: HANDLE_PROP, limit: LIMIT_PROP },
			required: ["screen_name"],
			additionalProperties: false,
		},
	},
] as const;

const TOOL_NAMES = new Set<string>(TOOLS.map((tool) => tool.name));

function ok(id: JsonRpcResponse["id"], result: unknown): JsonRpcResponse {
	return { jsonrpc: "2.0", id, result };
}

function toolText(text: string, isError = false) {
	return { content: [{ type: "text", text }], isError };
}

function friendlyError(err: unknown): string {
	if (err instanceof XAuthError) {
		return "Your X auth_token is invalid or expired. Update it in the MCP server settings.";
	}
	if (err instanceof XRateLimitError) {
		return "X is rate-limiting these requests. Try again in a little while.";
	}
	return err instanceof Error ? err.message : String(err);
}

function str(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	return typeof value === "string" ? value : "";
}

function num(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];
	return typeof value === "number" ? value : undefined;
}

async function runTool(
	name: string,
	args: Record<string, unknown>,
	authToken: string
) {
	const client = await createXClient(authToken);
	if (name === "x_search_users") {
		return toolText(
			JSON.stringify(await searchUsers(client, str(args, "screen_name")))
		);
	}
	if (name === "x_search_tweets") {
		return toolText(
			JSON.stringify(
				await searchTweets(client, str(args, "query"), num(args, "limit"))
			)
		);
	}
	return toolText(
		JSON.stringify(
			await userTweets(client, str(args, "screen_name"), num(args, "limit"))
		)
	);
}

function toArgs(params: Record<string, unknown> | undefined) {
	return typeof params?.arguments === "object" && params.arguments !== null
		? (params.arguments as Record<string, unknown>)
		: {};
}

async function callTool(
	id: JsonRpcResponse["id"],
	params: Record<string, unknown> | undefined,
	ctx: RequestContext
): Promise<JsonRpcResponse> {
	const name = typeof params?.name === "string" ? params.name : "";
	if (!TOOL_NAMES.has(name)) {
		return ok(id, toolText(`Unknown tool: ${name}`, true));
	}
	if (!ctx.authToken) {
		return ok(
			id,
			toolText(
				"No X auth_token configured. Add it as the bearer token on this MCP server.",
				true
			)
		);
	}
	try {
		return ok(id, await runTool(name, toArgs(params), ctx.authToken));
	} catch (err) {
		return ok(id, toolText(friendlyError(err), true));
	}
}

/** Handle one JSON-RPC message; null = notification (no response body). */
export function handleMessage(
	message: JsonRpcRequest,
	ctx: RequestContext
): Promise<JsonRpcResponse | null> {
	const id = message.id ?? null;
	if (message.method.startsWith("notifications/")) {
		return Promise.resolve(null);
	}
	switch (message.method) {
		case "initialize":
			return Promise.resolve(
				ok(id, {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: {} },
					serverInfo: SERVER_INFO,
				})
			);
		case "ping":
			return Promise.resolve(ok(id, {}));
		case "tools/list":
			return Promise.resolve(ok(id, { tools: TOOLS }));
		case "tools/call":
			return callTool(id, message.params, ctx);
		default:
			return Promise.resolve({
				jsonrpc: "2.0",
				id,
				error: {
					code: METHOD_NOT_FOUND,
					message: `Unknown method: ${message.method}`,
				},
			});
	}
}
