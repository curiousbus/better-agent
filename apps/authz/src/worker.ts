import { type Context, Hono, type Next } from "hono";
import { z } from "zod";
import { adminLogin, isValidAdminToken } from "./auth";
import { createDb, type Db } from "./db";
import {
	authorize,
	createCode,
	listCodes,
	redeem,
	revokeCode,
} from "./service";

interface ServiceBinding {
	fetch(request: Request): Promise<Response>;
}

interface Env {
	AUTHZ_DATABASE_URL: string;
	AUTHZ_JWT_SECRET: string;
	AUTHZ_SERVICE_SECRET: string;
	// Worker-to-worker binding to the main server (for the revoke push).
	MAIN?: ServiceBinding;
}

const BAD_REQUEST = 400;
const UNAUTHORIZED = 401;
const FORBIDDEN = 403;

const subjectInput = z.object({ subject: z.string().min(1) });
const redeemInput = z.object({
	subject: z.string().min(1),
	code: z.string().min(1),
});
const createInput = z.object({
	label: z.string().default(""),
	source: z.string().default(""),
});

// Tell the main server to drop its cached authorization for these subjects, so a
// revocation takes effect immediately (the 60s TTL is the fallback).
async function pushInvalidate(env: Env, subjects: string[]): Promise<void> {
	if (!(env.MAIN && subjects.length > 0)) {
		return;
	}
	try {
		await env.MAIN.fetch(
			new Request("https://main.internal/internal/authz-invalidate", {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-service-secret": env.AUTHZ_SERVICE_SECRET,
				},
				body: JSON.stringify({ subjects }),
			})
		);
	} catch {
		// best-effort; the TTL still expires the cache within 60s
	}
}

function registerServiceRoutes(app: Hono, db: Db, env: Env): void {
	// biome-ignore lint/suspicious/useAwait: Hono middleware must return a promise
	app.use("/service/*", async (c, next) => {
		if (c.req.header("x-service-secret") !== env.AUTHZ_SERVICE_SECRET) {
			return c.json({ error: "forbidden" }, FORBIDDEN);
		}
		return next();
	});
	app.post("/service/authorize", async (c) => {
		const input = subjectInput.safeParse(await c.req.json());
		if (!input.success) {
			return c.json({ error: "bad request" }, BAD_REQUEST);
		}
		return c.json({ authorized: await authorize(db, input.data.subject) });
	});
	app.post("/service/redeem", async (c) => {
		const input = redeemInput.safeParse(await c.req.json());
		if (!input.success) {
			return c.json({ error: "bad request" }, BAD_REQUEST);
		}
		return c.json(await redeem(db, input.data.subject, input.data.code));
	});
}

function registerAdminRoutes(app: Hono, db: Db, env: Env): void {
	app.post("/admin/login", async (c) => {
		const input = z
			.object({ email: z.string().min(1), password: z.string().min(1) })
			.safeParse(await c.req.json());
		if (!input.success) {
			return c.json({ error: "bad request" }, BAD_REQUEST);
		}
		const token = await adminLogin(
			db,
			env.AUTHZ_JWT_SECRET,
			input.data.email,
			input.data.password
		);
		return token
			? c.json({ token })
			: c.json({ error: "invalid credentials" }, UNAUTHORIZED);
	});

	app.use("/admin/codes/*", adminGuard(env));
	app.use("/admin/codes", adminGuard(env));

	app.get("/admin/codes", async (c) => c.json(await listCodes(db)));
	app.post("/admin/codes", async (c) => {
		const input = createInput.safeParse(await c.req.json());
		if (!input.success) {
			return c.json({ error: "bad request" }, BAD_REQUEST);
		}
		return c.json(await createCode(db, input.data));
	});
	app.post("/admin/codes/:id/revoke", async (c) => {
		const subjects = await revokeCode(db, c.req.param("id"));
		await pushInvalidate(env, subjects);
		return c.json({ ok: true });
	});
}

function adminGuard(env: Env) {
	return async (c: Context, next: Next) => {
		const token = c.req.header("authorization")?.replace("Bearer ", "");
		if (!(await isValidAdminToken(env.AUTHZ_JWT_SECRET, token))) {
			return c.json({ error: "unauthorized" }, UNAUTHORIZED);
		}
		return next();
	};
}

function buildApp(env: Env): Hono {
	const db = createDb(env.AUTHZ_DATABASE_URL);
	const app = new Hono();
	registerServiceRoutes(app, db, env);
	registerAdminRoutes(app, db, env);
	return app;
}

export default {
	fetch(request: Request, env: Env): Response | Promise<Response> {
		return buildApp(env).fetch(request);
	},
};
