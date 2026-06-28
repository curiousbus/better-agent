// Cloudflare Workers entry point.
//
// ENV NOTE: With `nodejs_compat` + compatibility_date >= 2025-09-23, Cloudflare
// populates `process.env` from vars/secrets at isolate init, so the
// `@better-agent/env/server` singleton (which reads `process.env`) should work
// as-is. If `wrangler dev` reports missing env vars, thread the `environment`
// binding into a config object and pass it explicitly to buildServices/env.
// The human iterates this via `wrangler dev` — do not over-engineer here.
import { createNeonDb } from "@better-agent/db/neon-db";
import { buildApp } from "./app";
import type { R2Bucket } from "./attachment-store";
import type { ServiceBinding } from "./authz-client";
import { buildServices } from "./services";

// Secrets injected by Cloudflare at runtime. AUTHZ is a service binding to the
// authz worker (same-account worker-to-worker; public-URL fetch is unreliable).
interface WorkerEnv {
	AUTHZ?: ServiceBinding;
	DATABASE_URL: string;
	// R2 bucket for chat attachments (images/files). Optional so the worker still
	// boots without it; attachment uploads error clearly until it's bound.
	UPLOADS?: R2Bucket;
}

export default {
	fetch(
		request: Request,
		environment: WorkerEnv
	): Response | Promise<Response> {
		// Build the DB connection (and the cheap closures around it) PER REQUEST.
		// Cloudflare Workers forbid reusing an I/O object (here, the Neon
		// WebSocket connection) across requests — a memoized connection from an
		// earlier request throws an uncaught exception ("Cannot perform I/O on
		// behalf of a different request", surfaced as a 1101). The one expensive
		// piece (the scrypt-derived secret box) is memoized inside buildServices.
		const db = createNeonDb(environment.DATABASE_URL);
		const services = buildServices(db, environment.AUTHZ, environment.UPLOADS);
		return buildApp(services).fetch(request);
	},
};
