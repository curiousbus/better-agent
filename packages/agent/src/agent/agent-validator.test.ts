import { describe, expect, it } from "vitest";
import {
	createFakeCredentialStore,
	createFakeModelStore,
} from "../testing/fakes";
import { createAgentValidator } from "./agent-validator";

function setup() {
	const modelStore = createFakeModelStore();
	const credentialStore = createFakeCredentialStore([
		{ providerId: "openai", apiKey: "sk-1", baseURL: null, enabled: true },
	]);
	return { modelStore, credentialStore };
}

const RE_CREDENTIAL = /credential/i;
const RE_MODEL = /model/i;

const MODEL = {
	providerId: "openai",
	modelId: "gpt-x",
	name: "GPT-X",
	contextLimit: 1000,
	maxOutputTokens: 100,
	inputPricePerM: 1,
	outputPricePerM: 2,
	capabilities: { toolCall: true, reasoning: false, vision: false },
};

describe("createAgentValidator", () => {
	it("returns null when provider has enabled credential and model exists", async () => {
		const { modelStore, credentialStore } = setup();
		await modelStore.replaceAll([MODEL]);
		const validator = createAgentValidator({ credentialStore, modelStore });
		expect(
			await validator.validate({ providerId: "openai", modelId: "gpt-x" })
		).toBeNull();
	});

	it("rejects when provider has no credential", async () => {
		const { modelStore } = setup();
		await modelStore.replaceAll([MODEL]);
		const validator = createAgentValidator({
			credentialStore: createFakeCredentialStore(),
			modelStore,
		});
		const error = await validator.validate({
			providerId: "openai",
			modelId: "gpt-x",
		});
		expect(error).toMatch(RE_CREDENTIAL);
	});

	it("rejects when credential is disabled", async () => {
		const { modelStore } = setup();
		await modelStore.replaceAll([MODEL]);
		const validator = createAgentValidator({
			credentialStore: createFakeCredentialStore([
				{ providerId: "openai", apiKey: "sk-1", baseURL: null, enabled: false },
			]),
			modelStore,
		});
		const error = await validator.validate({
			providerId: "openai",
			modelId: "gpt-x",
		});
		expect(error).toMatch(RE_CREDENTIAL);
	});

	it("rejects when model is not in the catalog", async () => {
		const { modelStore, credentialStore } = setup();
		await modelStore.replaceAll([MODEL]);
		const validator = createAgentValidator({ credentialStore, modelStore });
		const error = await validator.validate({
			providerId: "openai",
			modelId: "nope",
		});
		expect(error).toMatch(RE_MODEL);
	});
});
