import { describe, expect, it } from "vitest";
import { createFakeCatalogStore, createFakeModelStore } from "../testing/fakes";
import { createModelCatalog } from "./model-catalog";

const RAW = {
	openai: {
		id: "openai",
		name: "OpenAI",
		npm: "@ai-sdk/openai",
		models: { "gpt-x": { id: "gpt-x", limit: { context: 1000 } } },
	},
};

describe("ModelCatalog.sync", () => {
	it("fetches, parses and stores catalog + models", async () => {
		const catalogStore = createFakeCatalogStore();
		const modelStore = createFakeModelStore();
		const catalog = createModelCatalog({
			catalogStore,
			modelStore,
			fetcher: () => Promise.resolve(RAW),
		});

		await catalog.sync();

		expect((await catalogStore.list())[0].providerId).toBe("openai");
		expect((await modelStore.listByProvider("openai"))[0].modelId).toBe(
			"gpt-x"
		);
	});

	it("keeps old cache when fetch fails", async () => {
		const catalogStore = createFakeCatalogStore();
		await catalogStore.replaceAll([
			{
				providerId: "x",
				name: "X",
				npm: null,
				defaultBaseURL: null,
				envKeys: [],
			},
		]);
		const catalog = createModelCatalog({
			catalogStore,
			modelStore: createFakeModelStore(),
			fetcher: () => Promise.reject(new Error("network")),
		});

		const result = await catalog.sync();

		expect(result.ok).toBe(false);
		expect((await catalogStore.list())[0].providerId).toBe("x");
	});
});
