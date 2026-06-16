import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { createXai } from "@ai-sdk/xai";

export interface AdapterCredential {
	apiKey: string;
	baseURL: string | null;
}

export type ModelMaker = (modelId: string) => LanguageModelV3;

type NativeFactory = (cred: AdapterCredential) => ModelMaker;

function baseURLOption(cred: AdapterCredential): { baseURL?: string } {
	return cred.baseURL === null ? {} : { baseURL: cred.baseURL };
}

const NATIVE_ADAPTERS: Record<string, NativeFactory> = {
	"@ai-sdk/anthropic": (cred) => {
		const provider = createAnthropic({
			apiKey: cred.apiKey,
			...baseURLOption(cred),
		});
		return (modelId) => provider(modelId);
	},
	"@ai-sdk/openai": (cred) => {
		const provider = createOpenAI({
			apiKey: cred.apiKey,
			...baseURLOption(cred),
		});
		return (modelId) => provider(modelId);
	},
	"@ai-sdk/google": (cred) => {
		const provider = createGoogleGenerativeAI({
			apiKey: cred.apiKey,
			...baseURLOption(cred),
		});
		return (modelId) => provider(modelId);
	},
	"@ai-sdk/xai": (cred) => {
		const provider = createXai({
			apiKey: cred.apiKey,
			...baseURLOption(cred),
		});
		return (modelId) => provider(modelId);
	},
};

function fallbackMaker(npm: string, cred: AdapterCredential): ModelMaker {
	if (!cred.baseURL) {
		throw new Error(
			`Provider package "${npm}" is not bundled and no baseURL was provided for openai-compatible fallback`
		);
	}
	const provider = createOpenAICompatible({
		name: npm,
		apiKey: cred.apiKey,
		baseURL: cred.baseURL,
	});
	return (modelId) => provider(modelId);
}

export function loadAdapter(
	npm: string,
	cred: AdapterCredential
): Promise<ModelMaker> {
	const native = NATIVE_ADAPTERS[npm];
	if (native) {
		return Promise.resolve(native(cred));
	}
	try {
		return Promise.resolve(fallbackMaker(npm, cred));
	} catch (err) {
		return Promise.reject(err);
	}
}
