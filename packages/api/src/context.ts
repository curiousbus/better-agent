import type { AgentConfig } from "@better-agent/agent/agent/types";
import type { User } from "@better-agent/agent/auth/types";
import type { Context as HonoContext } from "hono";
import type { AgentServices } from "./services";

export interface CreateContextOptions {
	context: HonoContext;
	services: AgentServices;
}

const BEARER_PREFIX = "Bearer ";
// A JWT is three dot-separated segments (header.payload.signature); agent
// tokens are `ba_<base64url>` and never contain a dot — so the token shape
// tells us which strategy to run, and a request pays for at most one.
const JWT_SEGMENTS = 3;

function extractBearerToken(options: CreateContextOptions): string | null {
	const header = options.context.req.header("authorization");
	if (!header?.startsWith(BEARER_PREFIX)) {
		return null;
	}
	const token = header.slice(BEARER_PREFIX.length).trim();
	return token === "" ? null : token;
}

function looksLikeJwt(token: string): boolean {
	return token.split(".").length === JWT_SEGMENTS;
}

async function resolveAuthedAgent(
	options: CreateContextOptions,
	token: string
): Promise<AgentConfig | null> {
	const { tokenService, stores } = options.services;
	if (!(tokenService && stores.agent)) {
		return null;
	}
	return await stores.agent.findByTokenHash(tokenService.hash(token));
}

async function resolveAuthedUser(
	options: CreateContextOptions,
	token: string
): Promise<User | null> {
	const { jwtService, stores } = options.services;
	if (!(jwtService && stores.user)) {
		return null;
	}
	const claims = await jwtService.verify(token);
	if (!claims) {
		return null;
	}
	return stores.user.findById(claims.sub);
}

function clientIp(options: CreateContextOptions): string {
	const fwd = options.context.req.header("x-forwarded-for");
	return fwd?.split(",")[0]?.trim() || "unknown";
}

function userAgent(options: CreateContextOptions): string | null {
	return options.context.req.header("user-agent") ?? null;
}

// Keeps a detached promise alive past the response (Workers executionCtx).
// Falls back to fire-and-forget outside Workers (node dev / tests).
function extractWaitUntil(
	options: CreateContextOptions
): (p: Promise<unknown>) => void {
	try {
		const ctx = options.context.executionCtx;
		if (ctx && typeof ctx.waitUntil === "function") {
			return (p) => ctx.waitUntil(p);
		}
	} catch {
		// hono throws when no execution context exists (plain node) — fall through.
	}
	return (p) => {
		p.catch(() => undefined);
	};
}

export async function createContext(options: CreateContextOptions) {
	const token = extractBearerToken(options);
	let authedAgent: AgentConfig | null = null;
	let authedUser: User | null = null;
	if (token) {
		if (looksLikeJwt(token)) {
			authedUser = await resolveAuthedUser(options, token);
		} else {
			authedAgent = await resolveAuthedAgent(options, token);
		}
	}
	return {
		services: options.services,
		authedAgent,
		authedUser,
		clientIp: clientIp(options),
		userAgent: userAgent(options),
		waitUntil: extractWaitUntil(options),
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
