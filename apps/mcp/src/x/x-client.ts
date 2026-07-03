import { TwitterOpenApi } from "twitter-openapi-typescript";
import { XAuthError, XError } from "./x-errors";

export type XClient = Awaited<
	ReturnType<TwitterOpenApi["getClientFromCookies"]>
>;

type HeadersWithGetSetCookie = Headers & { getSetCookie?: () => string[] };

const MIN_TOKEN_LEN = 20;
const MANIFEST_TIMEOUT_MS = 15_000;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;
const CLIENT_ERROR = 400;

async function fetchManifest(authToken: string): Promise<Response> {
	try {
		return await fetch("https://x.com/manifest.json", {
			headers: { cookie: `auth_token=${authToken}` },
			signal: AbortSignal.timeout(MANIFEST_TIMEOUT_MS),
		});
	} catch (cause) {
		const detail = cause instanceof Error ? cause.message : String(cause ?? "");
		throw new XError(`failed to GET x.com/manifest.json: ${detail}`, cause);
	}
}

function assertManifestOk(status: number): void {
	if (status === UNAUTHORIZED || status === FORBIDDEN) {
		throw new XAuthError(`manifest.json returned ${status}`);
	}
	if (status >= CLIENT_ERROR) {
		throw new XError(`manifest.json returned ${status}`);
	}
}

function parseSetCookies(resp: Response): Record<string, string> {
	const cookies: Record<string, string> = {};
	const raw = (resp.headers as HeadersWithGetSetCookie).getSetCookie?.() ?? [];
	for (const cookie of raw) {
		const first = cookie.split(";")[0] ?? "";
		const eq = first.indexOf("=");
		if (eq <= 0) {
			continue;
		}
		const name = first.slice(0, eq).trim();
		if (name) {
			cookies[name] = first.slice(eq + 1).trim();
		}
	}
	return cookies;
}

export async function createXClient(authToken: string): Promise<XClient> {
	if (!authToken || authToken.length < MIN_TOKEN_LEN) {
		throw new XAuthError("auth_token is empty or too short");
	}
	const resp = await fetchManifest(authToken);
	assertManifestOk(resp.status);
	const cookieObj = parseSetCookies(resp);
	const api = new TwitterOpenApi();
	return api.getClientFromCookies({ ...cookieObj, auth_token: authToken });
}
