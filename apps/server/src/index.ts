import { createAgentValidator } from "@better-agent/agent/agent/agent-validator";
import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { createModelCatalog } from "@better-agent/agent/provider/model-catalog";
import { createModelFactory } from "@better-agent/agent/provider/model-factory";
import { fetchModelsDev } from "@better-agent/agent/provider/models-dev";
import { createContext } from "@better-agent/api/context";
import { appRouter } from "@better-agent/api/routers/index";
import { db } from "@better-agent/db";
import { createAgentStore } from "@better-agent/db/repositories/agent-store";
import {
	createModelCacheStore,
	createProviderCatalogStore,
	createProviderCredentialStore,
} from "@better-agent/db/repositories/provider-stores";
import { env } from "@better-agent/env/server";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { initLogger, log } from "evlog";
import { type EvlogVariables, evlog } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";

initLogger({
	env: { service: "better-agent-server" },
});

function buildServices() {
	const secretBox = createSecretBox(env.CREDENTIALS_SECRET);
	const providerCatalog = createProviderCatalogStore(db);
	const modelCache = createModelCacheStore(db);
	const providerCredential = createProviderCredentialStore(db, secretBox);
	const agent = createAgentStore(db);
	const agentValidator = createAgentValidator({
		credentialStore: providerCredential,
		modelStore: modelCache,
	});
	return {
		catalog: createModelCatalog({
			catalogStore: providerCatalog,
			modelStore: modelCache,
			fetcher: () => fetchModelsDev(env.MODELS_DEV_URL),
		}),
		modelFactory: createModelFactory({
			catalogStore: providerCatalog,
			credentialStore: providerCredential,
		}),
		agentValidator,
		stores: { providerCatalog, modelCache, providerCredential, agent },
	};
}

const services = buildServices();

const app = new Hono<EvlogVariables>();

app.use(evlog());

app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
	})
);

export const apiHandler = new OpenAPIHandler(appRouter, {
	plugins: [
		new OpenAPIReferencePlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
	],
	interceptors: [
		onError((error) => {
			log.error({ error });
		}),
	],
});

export const rpcHandler = new RPCHandler(appRouter, {
	interceptors: [
		onError((error) => {
			log.error({ error });
		}),
	],
});

app.use("/*", async (c, next) => {
	const context = await createContext({ context: c, services });

	const rpcResult = await rpcHandler.handle(c.req.raw, {
		prefix: "/rpc",
		context,
	});

	if (rpcResult.matched) {
		return c.newResponse(rpcResult.response.body, rpcResult.response);
	}

	const apiResult = await apiHandler.handle(c.req.raw, {
		prefix: "/api-reference",
		context,
	});

	if (apiResult.matched) {
		return c.newResponse(apiResult.response.body, apiResult.response);
	}

	return await next();
});

app.get("/", (c) => c.text("OK"));

import { serve } from "@hono/node-server";

serve(
	{
		fetch: app.fetch,
		port: 3000,
	},
	(info) => {
		log.info("server", `Server is running on http://localhost:${info.port}`);
	}
);
