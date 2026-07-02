import type {
	ComposioConnectionMeta,
	ComposioService,
	ComposioToolkitMeta,
	ComposioToolMeta,
} from "@better-agent/agent/tool/composio-tools";
import type { ExecuteResult } from "@better-agent/agent/tool/types";
import { AuthScheme, Composio } from "@composio/core";
import { log } from "evlog";

const MAX_CAUSE_DEPTH = 4;

// composio wraps real errors as `new XError(msg, { cause: realError })`, so the
// HTTP status / network reason lives in the cause chain — unwrap it.
function errorDetail(error: unknown, depth = 0): string {
	if (depth > MAX_CAUSE_DEPTH) {
		return "…";
	}
	if (!(error instanceof Error)) {
		try {
			return JSON.stringify(error);
		} catch {
			return String(error);
		}
	}
	const e = error as Error & { status?: unknown; statusCode?: unknown };
	const status = e.status ?? e.statusCode;
	const head = `${e.name}: ${e.message}${status === undefined ? "" : ` (status=${String(status)})`}`;
	return e.cause ? `${head} <- ${errorDetail(e.cause, depth + 1)}` : head;
}

// Composio calls go over the network; if its API is slow/unreachable a request
// can hang, which would keep client queries pending forever (a spinning UI). Cap
// every call so it fails fast and the routers can degrade gracefully.
const COMPOSIO_TIMEOUT_MS = 12_000;

function withTimeout<T>(fn: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`timed out after ${COMPOSIO_TIMEOUT_MS}ms`)),
			COMPOSIO_TIMEOUT_MS
		);
		fn().then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			}
		);
	});
}

// Surface composio failures (the routers swallow them to keep the UI graceful),
// so a misconfigured key / SDK error is diagnosable from the server logs.
async function withLog<T>(op: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await withTimeout(fn);
	} catch (error) {
		log.error("composio", `${op} failed: ${errorDetail(error)}`);
		throw error;
	}
}

/** The subset of an OpenAI-format composio tool we read. */
interface OpenAiTool {
	function: {
		name: string;
		description?: string;
		parameters?: Record<string, unknown>;
	};
	type: "function";
}

/**
 * The subset of a composio execute result we read.
 * `data` is Record<string, unknown> and `error` is string | null
 * per ToolExecuteResponseSchema in @composio/core@0.11.x.
 */
interface ComposioResult {
	data: Record<string, unknown>;
	error: string | null;
	successful: boolean;
}

/** The subset of a connected account item from @composio/core@0.11 that we read. */
interface ConnectedAccountItem {
	id: string;
	status: string;
	toolkit: { slug: string };
}

/** The subset of a ToolKitItem from @composio/core@0.11 that we read. */
interface ToolKitItem {
	authSchemes?: string[];
	meta?: { description?: string };
	name: string;
	noAuth?: boolean;
	slug: string;
}

export function mapConnection(
	item: ConnectedAccountItem
): ComposioConnectionMeta {
	return {
		id: item.id,
		toolkitSlug: item.toolkit.slug,
		status: item.status,
		active: item.status === "ACTIVE",
	};
}

export function mapToolkit(item: ToolKitItem): ComposioToolkitMeta {
	const needsAuth =
		!item.noAuth && (item.authSchemes ?? []).some((s) => s !== "NO_AUTH");
	return {
		slug: item.slug,
		name: item.name,
		description: item.meta?.description ?? "",
		needsAuth,
		authSchemes: item.authSchemes ?? [],
	};
}

export function mapOpenAiTool(tool: OpenAiTool): ComposioToolMeta {
	return {
		name: tool.function.name,
		description: tool.function.description ?? "",
		parameters: tool.function.parameters ?? {},
	};
}

export function mapComposioResult(result: ComposioResult): ExecuteResult {
	if (result.successful) {
		return { output: JSON.stringify(result.data) };
	}
	return { output: result.error ?? "Tool execution failed", isError: true };
}

function buildToolMethods(
	composio: Composio
): Pick<ComposioService, "listTools" | "execute" | "listToolkits"> {
	return {
		listTools(userId, toolkits) {
			// No toolkits selected for this agent → no composio tools, and crucially
			// no composio network call (so agents that don't use composio never pay
			// for it / never hang on it).
			if (toolkits.length === 0) {
				return Promise.resolve([]);
			}
			return withLog("listTools", async () => {
				const tools = await composio.tools.get(userId, { toolkits });
				return (tools as OpenAiTool[]).map(mapOpenAiTool);
			});
		},
		execute({ userId, toolName, args }) {
			return withLog("execute", async () => {
				const result = (await composio.tools.execute(toolName, {
					userId,
					arguments: (args ?? {}) as Record<string, unknown>,
					// We don't pin tool versions; skip the SDK's version-match check
					// so execute always runs against composio's current tool version.
					dangerouslySkipVersionCheck: true,
				})) as ComposioResult;
				return mapComposioResult(result);
			});
		},
		listToolkits() {
			return withLog("listToolkits", async () => {
				const toolkits = await composio.toolkits.get({});
				return (toolkits as ToolKitItem[]).map(mapToolkit);
			});
		},
	};
}

function keyConnectionData(scheme: string, key: string) {
	return scheme === "BEARER_TOKEN"
		? AuthScheme.BearerToken({ token: key })
		: AuthScheme.APIKey({ api_key: key });
}

// Key-authenticated toolkits (tavily etc.) can't use the OAuth authorize flow —
// they need an auth config + a connected account carrying the user's key.
async function initiateKeyConnection(
	composio: Composio,
	input: { userId: string; toolkit: string; scheme: string; key: string }
): Promise<{ status: string }> {
	const configs = (await composio.authConfigs.list({
		toolkit: input.toolkit,
	})) as { items: Array<{ id: string }> };
	const authConfigId =
		configs.items[0]?.id ??
		(
			(await composio.authConfigs.create(input.toolkit, {
				type: "use_composio_managed_auth",
			})) as { id: string }
		).id;
	const res = (await composio.connectedAccounts.initiate(
		input.userId,
		authConfigId,
		{ config: keyConnectionData(input.scheme, input.key) }
	)) as { status: string };
	return { status: res.status };
}

function buildConnectionMethods(
	composio: Composio
): Pick<
	ComposioService,
	"connect" | "connectWithKey" | "listConnections" | "disconnect"
> {
	return {
		connect(userId, toolkit) {
			return withLog("connect", async () => {
				const req = await composio.toolkits.authorize(userId, toolkit);
				return { redirectUrl: req.redirectUrl ?? "" };
			});
		},
		connectWithKey(input) {
			return withLog("connectWithKey", () =>
				initiateKeyConnection(composio, input)
			);
		},
		listConnections(userId) {
			return withLog("listConnections", async () => {
				const res = (await composio.connectedAccounts.list({
					userIds: [userId],
				})) as { items: ConnectedAccountItem[] };
				return res.items.map(mapConnection);
			});
		},
		disconnect(connectionId) {
			return withLog("disconnect", async () => {
				await composio.connectedAccounts.delete(connectionId);
			});
		},
	};
}

export function createComposioService(config: {
	apiKey: string;
}): ComposioService {
	const composio = new Composio({ apiKey: config.apiKey });
	return {
		...buildToolMethods(composio),
		...buildConnectionMethods(composio),
	};
}
