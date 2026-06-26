// Cloudflare Workers entry point.
//
// ENV NOTE: With `nodejs_compat` + compatibility_date >= 2025-09-23, Cloudflare
// populates `process.env` from vars/secrets at isolate init, so the
// `@better-agent/env/server` singleton (which reads `process.env`) should work
// as-is. If `wrangler dev` reports missing env vars, thread the `environment`
// binding into a config object and pass it explicitly to buildServices/env.
// The human iterates this via `wrangler dev` — do not over-engineer here.
import { createNeonDb } from "@better-agent/db/neon-db";
import type { EvlogVariables } from "evlog/hono";
import type { Hono } from "hono";
import { buildApp } from "./app";
import { buildServices } from "./services";

// Secrets injected by Cloudflare at runtime (set via `wrangler secret put`).
type WorkerEnv = { DATABASE_URL: string } & Record<string, string>;

let cached: Hono<EvlogVariables> | null = null;

function getApp(environment: WorkerEnv): Hono<EvlogVariables> {
	if (!cached) {
		const db = createNeonDb(environment.DATABASE_URL);
		const services = buildServices(db);
		cached = buildApp(services);
	}
	return cached;
}

export default {
	fetch(
		request: Request,
		environment: WorkerEnv
	): Response | Promise<Response> {
		return getApp(environment).fetch(request);
	},
};
