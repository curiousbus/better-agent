import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "../testing/test-db";
import {
	createModelCacheStore,
	createProviderCatalogStore,
	createProviderCredentialStore,
} from "./provider-stores";

const box = createSecretBox("0123456789abcdef0123456789abcdef");

// Each test runs against a fresh, in-memory PGlite (real Postgres in WASM).
// Nothing persists across tests and no real database is touched.
let db: TestDb;
let client: PGlite;

beforeEach(async () => {
	({ db, client } = await createTestDb());
});

afterEach(async () => {
	await client.close();
});

it("catalog replaceAll + get + list", async () => {
	const store = createProviderCatalogStore(db);
	await store.replaceAll([
		{
			providerId: "openai",
			name: "OpenAI",
			npm: "@ai-sdk/openai",
			defaultBaseURL: null,
			envKeys: ["OPENAI_API_KEY"],
		},
		{
			providerId: "anthropic",
			name: "Anthropic",
			npm: "@ai-sdk/anthropic",
			defaultBaseURL: "https://api.anthropic.com",
			envKeys: [],
		},
	]);
	expect((await store.get("openai"))?.name).toBe("OpenAI");
	expect((await store.list()).length).toBe(2);
	expect(await store.get("missing")).toBeNull();
});

it("catalog replaceAll overwrites previous rows", async () => {
	const store = createProviderCatalogStore(db);
	await store.replaceAll([
		{
			providerId: "openai",
			name: "OpenAI",
			npm: "@ai-sdk/openai",
			defaultBaseURL: null,
			envKeys: [],
		},
	]);
	await store.replaceAll([
		{
			providerId: "anthropic",
			name: "Anthropic",
			npm: "@ai-sdk/anthropic",
			defaultBaseURL: null,
			envKeys: [],
		},
	]);
	expect(await store.get("openai")).toBeNull();
	expect((await store.list()).length).toBe(1);
});

it("model cache replaceAll + listByProvider + get", async () => {
	const store = createModelCacheStore(db);
	await store.replaceAll([
		{
			providerId: "openai",
			modelId: "gpt-x",
			name: "GPT-X",
			contextLimit: 1000,
			maxOutputTokens: 100,
			inputPricePerM: 1,
			outputPricePerM: 2,
			capabilities: { toolCall: true, reasoning: false, vision: false },
		},
	]);
	expect((await store.listByProvider("openai"))[0]?.modelId).toBe("gpt-x");
	expect((await store.get("openai", "gpt-x"))?.name).toBe("GPT-X");
	expect(await store.get("openai", "nope")).toBeNull();
});

it("credential upsert stores ciphertext, get decrypts, listMasked hides key", async () => {
	const store = createProviderCredentialStore(db, box);
	await store.upsert({
		providerId: "openai",
		apiKey: "sk-secret-1234",
		baseURL: null,
		enabled: true,
	});
	expect((await store.get("openai"))?.apiKey).toBe("sk-secret-1234");

	const masked = await store.listMasked();
	expect(masked[0]?.last4).toBe("1234");
	expect(JSON.stringify(masked)).not.toContain("sk-secret-1234");
});

it("credential upsert updates existing row and delete removes it", async () => {
	const store = createProviderCredentialStore(db, box);
	await store.upsert({
		providerId: "openai",
		apiKey: "sk-first-0000",
		baseURL: null,
		enabled: true,
	});
	await store.upsert({
		providerId: "openai",
		apiKey: "sk-second-9999",
		baseURL: "https://proxy.example.com/v1",
		enabled: false,
	});
	const updated = await store.get("openai");
	expect(updated?.apiKey).toBe("sk-second-9999");
	expect(updated?.enabled).toBe(false);
	expect(updated?.baseURL).toBe("https://proxy.example.com/v1");

	await store.delete("openai");
	expect(await store.get("openai")).toBeNull();
});
