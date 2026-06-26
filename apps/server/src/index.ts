import { createNodeDb } from "@better-agent/db/node-db";
import { env } from "@better-agent/env/server";
import { serve } from "@hono/node-server";
import { initLogger, log } from "evlog";
import { buildApp } from "./app";
import { buildServices } from "./services";

initLogger({
	env: { service: "better-agent-server" },
});

const db = createNodeDb(env.DATABASE_URL);
const services = buildServices(db);
const app = buildApp(services);

serve(
	{
		fetch: app.fetch,
		port: 3000,
	},
	(info) => {
		log.info("server", `Server is running on http://localhost:${info.port}`);
	}
);
