import { createModelCatalog } from "@better-agent/agent/provider/model-catalog";
import { createModelFactory } from "@better-agent/agent/provider/model-factory";
import {
	createFakeCatalogStore,
	createFakeCredentialStore,
	createFakeModelStore,
} from "@better-agent/agent/testing/fakes";
import { createRouterClient } from "@orpc/server";
import { expect, it } from "vitest";
import { appRouter } from "./index";

const SAMPLE = {
	openai: {
		id: "openai",
		name: "OpenAI",
		npm: "@ai-sdk/openai",
		models: { "gpt-x": { id: "gpt-x", limit: { context: 1000 } } },
	},
};

function buildClient() {
	const providerCatalog = createFakeCatalogStore();
	const modelCache = createFakeModelStore();
	const providerCredential = createFakeCredentialStore();
	const services = {
		catalog: createModelCatalog({
			catalogStore: providerCatalog,
			modelStore: modelCache,
			fetcher: () => Promise.resolve(SAMPLE),
		}),
		modelFactory: createModelFactory({
			catalogStore: providerCatalog,
			credentialStore: providerCredential,
		}),
		stores: { providerCatalog, modelCache, providerCredential },
	};
	return createRouterClient(appRouter, {
		context: { services: services as never },
	});
}

it("refresh populates catalog and models", async () => {
	const client = buildClient();
	const result = await client.providers.catalogRefresh();
	expect(result.ok).toBe(true);
	expect((await client.providers.catalogList())[0]?.providerId).toBe("openai");
	expect(
		(await client.providers.modelsList({ providerId: "openai" }))[0]?.modelId
	).toBe("gpt-x");
});

it("credential upsert is masked in list", async () => {
	const client = buildClient();
	await client.providers.credentialsUpsert({
		providerId: "openai",
		apiKey: "sk-abcd-1234",
		baseURL: null,
		enabled: true,
	});
	const masked = await client.providers.credentialsList();
	expect(masked[0]?.last4).toBe("1234");
	expect(JSON.stringify(masked)).not.toContain("sk-abcd-1234");
});
