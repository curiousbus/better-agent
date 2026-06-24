import type { SharedV3ProviderOptions } from "@ai-sdk/provider";
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
	providerOptions: SharedV3ProviderOptions;
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
			// Intentional harmless fallback: the AI SDK ignores unknown providerOptions keys,
			// so an "openai" key on a non-OpenAI provider is a no-op.
			return { strategy: "prompt-cache-key", providerKey: "openai" };
	}
}

/** Returns the index of the last message in the leading contiguous system-message run, or -1. */
function lastLeadingSystemIndex(messages: ModelMessage[]): number {
	let idx = -1;
	for (const msg of messages) {
		if (msg.role !== "system") {
			break;
		}
		idx++;
	}
	return idx;
}

/**
 * Tags the LAST message in the leading contiguous run of system messages with
 * Anthropic's cacheControl at the message-level providerOptions. This ensures
 * the cached prefix covers ALL leading system messages (system prompt + any
 * compaction summary), not just the first one.
 *
 * The Anthropic SDK reads cacheControl from message.providerOptions (not from
 * content parts) for system messages, since SystemModelMessage.content is
 * typed as `string` in the AI SDK.
 */
function tagSystemMessage(messages: ModelMessage[]): ModelMessage[] {
	const targetIdx = lastLeadingSystemIndex(messages);
	if (targetIdx === -1) {
		return messages;
	}
	return messages.map((msg, i) => {
		if (i !== targetIdx) {
			return msg;
		}
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
