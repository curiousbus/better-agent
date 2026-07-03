import { Hono } from "hono";
import { handleMessage } from "./mcp-server";

// Streamable HTTP endpoint in stateless JSON mode: every POST carries one
// JSON-RPC message; responses come back as application/json (the spec allows
// a plain JSON body instead of an SSE stream). No session state is kept — the
// user's X auth_token rides on each request as the bearer token.

const ACCEPTED = 202;
const BAD_REQUEST = 400;
const PARSE_ERROR = -32_700;
const BEARER_RE = /^Bearer\s+(.+)$/i;

function bearerToken(header: string | undefined): string | null {
	if (!header) {
		return null;
	}
	const match = header.match(BEARER_RE);
	return match ? (match[1]?.trim() ?? null) : null;
}

export function buildApp(): Hono {
	const app = new Hono();

	app.get("/", (c) => c.text("better-agent-mcp OK"));

	app.post("/", async (c) => {
		let message: Parameters<typeof handleMessage>[0];
		try {
			message = await c.req.json();
		} catch {
			return c.json(
				{
					jsonrpc: "2.0",
					id: null,
					error: { code: PARSE_ERROR, message: "Parse error" },
				},
				BAD_REQUEST
			);
		}
		const authToken = bearerToken(c.req.header("authorization"));
		const response = await handleMessage(message, { authToken });
		if (response === null) {
			return c.body(null, ACCEPTED);
		}
		return c.json(response);
	});

	return app;
}
