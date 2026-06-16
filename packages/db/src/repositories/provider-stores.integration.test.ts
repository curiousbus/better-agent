import { createSecretBox } from "@better-agent/agent/crypto/secret-box";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: drizzle 需要整个 schema 命名空间对象
import * as schema from "../schema";
import {
	createProviderCatalogStore,
	createProviderCredentialStore,
} from "./provider-stores";

const url = process.env.DATABASE_URL;
const db = drizzle(url ?? "", { schema });
const box = createSecretBox("0123456789abcdef0123456789abcdef");

describe.skipIf(!url)("provider stores (integration)", () => {
	beforeEach(async () => {
		await db.delete(schema.providersCatalog);
		await db.delete(schema.providerCredentials);
	});
	afterAll(async () => {
		await db.delete(schema.providersCatalog);
		await db.delete(schema.providerCredentials);
	});

	it("catalog replaceAll + get", async () => {
		const store = createProviderCatalogStore(db);
		await store.replaceAll([
			{
				providerId: "openai",
				name: "OpenAI",
				npm: "@ai-sdk/openai",
				defaultBaseURL: null,
				envKeys: ["OPENAI_API_KEY"],
			},
		]);
		expect((await store.get("openai"))?.name).toBe("OpenAI");
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
});
