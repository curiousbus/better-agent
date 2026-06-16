import { describe, expect, it } from "vitest";
import {
	createFakeCatalogStore,
	createFakeCredentialStore,
} from "../testing/fakes";
import { createModelFactory } from "./model-factory";

const CREDENTIAL_ERROR = /credential/;

async function setup() {
	const catalogStore = createFakeCatalogStore();
	await catalogStore.replaceAll([
		{
			providerId: "anthropic",
			name: "Anthropic",
			npm: "@ai-sdk/anthropic",
			defaultBaseURL: "https://api.anthropic.com",
			envKeys: [],
		},
	]);
	const credentialStore = createFakeCredentialStore([
		{
			providerId: "anthropic",
			apiKey: "sk-test",
			baseURL: null,
			enabled: true,
		},
	]);
	return createModelFactory({ catalogStore, credentialStore });
}

describe("createModelFactory", () => {
	it("builds a language model from catalog + credential", async () => {
		const factory = await setup();
		const model = await factory.create("anthropic", "claude-opus-4-8");
		expect(model.modelId).toBe("claude-opus-4-8");
	});

	it("throws when provider has no credential", async () => {
		const catalogStore = createFakeCatalogStore();
		await catalogStore.replaceAll([
			{
				providerId: "openai",
				name: "OpenAI",
				npm: "@ai-sdk/openai",
				defaultBaseURL: null,
				envKeys: [],
			},
		]);
		const factory = createModelFactory({
			catalogStore,
			credentialStore: createFakeCredentialStore(),
		});
		await expect(factory.create("openai", "gpt-x")).rejects.toThrow(
			CREDENTIAL_ERROR
		);
	});
});
