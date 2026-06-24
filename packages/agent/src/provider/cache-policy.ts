import type { ModelMessage } from "ai";

export type CacheStrategy =
	| "anthropic-breakpoint"
	| "prompt-cache-key"
	| "none";

interface CachePolicy {
	providerKey: string;
	strategy: CacheStrategy;
}

interface ApplyCachePolicyInput {
	messages: ModelMessage[];
	sessionId: string;
}

interface ApplyCachePolicyOutput {
	messages: ModelMessage[];
	providerOptions: Record<string, Record<string, unknown>>;
}

const ANTHROPIC_NPM = "@ai-sdk/anthropic";
const OPENAI_NPM = "@ai-sdk/openai";
const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible";
const GOOGLE_NPM = "@ai-sdk/google";
const XAI_NPM = "@ai-sdk/xai";

export function resolveCachePolicy(providerNpm: string | null): CachePolicy {
	switch (providerNpm) {
		case ANTHROPIC_NPM:
			return { strategy: "anthropic-breakpoint", providerKey: "anthropic" };
		case OPENAI_NPM:
		case OPENAI_COMPATIBLE_NPM:
			return { strategy: "prompt-cache-key", providerKey: "openai" };
		case XAI_NPM:
			return { strategy: "prompt-cache-key", providerKey: "xai" };
		case GOOGLE_NPM:
			return { strategy: "none", providerKey: "google" };
		default:
			return { strategy: "prompt-cache-key", providerKey: "openai" };
	}
}

/**
 * Tags the first system message with Anthropic's cacheControl at the
 * message-level providerOptions. The Anthropic SDK reads cacheControl from
 * message.providerOptions (not from content parts) for system messages, since
 * SystemModelMessage.content is typed as `string` in the AI SDK.
 */
function tagSystemMessage(messages: ModelMessage[]): ModelMessage[] {
	let tagged = false;
	return messages.map((msg) => {
		if (!tagged && msg.role === "system") {
			tagged = true;
			return {
				...msg,
				providerOptions: {
					...msg.providerOptions,
					anthropic: {
						...(msg.providerOptions?.anthropic as
							| Record<string, unknown>
							| undefined),
						cacheControl: { type: "ephemeral" },
					},
				},
			};
		}
		return msg;
	});
}

export function applyCachePolicy(
	input: ApplyCachePolicyInput,
	policy: CachePolicy
): ApplyCachePolicyOutput {
	const { messages, sessionId } = input;
	const { strategy, providerKey } = policy;

	switch (strategy) {
		case "anthropic-breakpoint":
			return { messages: tagSystemMessage(messages), providerOptions: {} };
		case "prompt-cache-key":
			return {
				messages,
				providerOptions: { [providerKey]: { promptCacheKey: sessionId } },
			};
		case "none":
			return { messages, providerOptions: {} };
		default:
			return { messages, providerOptions: {} };
	}
}
