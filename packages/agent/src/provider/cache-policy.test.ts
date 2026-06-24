import type { ModelMessage } from "ai";
import { expect, it } from "vitest";
import { applyCachePolicy, resolveCachePolicy } from "./cache-policy";

it("maps anthropic npm to the breakpoint strategy", () => {
	expect(resolveCachePolicy("@ai-sdk/anthropic").strategy).toBe(
		"anthropic-breakpoint"
	);
});
it("maps openai npm to the prompt-cache-key strategy", () => {
	const p = resolveCachePolicy("@ai-sdk/openai");
	expect(p.strategy).toBe("prompt-cache-key");
	expect(p.providerKey).toBe("openai");
});
it("maps google npm to none", () => {
	expect(resolveCachePolicy("@ai-sdk/google").strategy).toBe("none");
});
it("unknown/null npm falls back to a prompt-cache-key strategy", () => {
	expect(resolveCachePolicy(null).strategy).toBe("prompt-cache-key");
});

it("anthropic policy tags the system message with cacheControl in providerOptions", () => {
	const messages: ModelMessage[] = [
		{ role: "system", content: "SYS" },
		{ role: "user", content: "hi" },
	];
	const out = applyCachePolicy(
		{ messages, sessionId: "s1" },
		{ strategy: "anthropic-breakpoint", providerKey: "anthropic" }
	);
	const sys = out.messages[0];
	// SystemModelMessage.content is typed as string (not array); the Anthropic SDK
	// reads cacheControl from message-level providerOptions for system messages.
	expect(sys?.providerOptions?.anthropic).toMatchObject({
		cacheControl: { type: "ephemeral" },
	});
});

it("prompt-cache-key policy sets promptCacheKey=sessionId in providerOptions", () => {
	const out = applyCachePolicy(
		{ messages: [], sessionId: "s1" },
		{ strategy: "prompt-cache-key", providerKey: "openai" }
	);
	expect(out.providerOptions.openai?.promptCacheKey).toBe("s1");
});

it("tags the last leading system message (summary) for anthropic", () => {
	const messages: ModelMessage[] = [
		{ role: "system", content: "SYS" },
		{ role: "system", content: "对话摘要：recap" },
		{ role: "user", content: "hi" },
	];
	const out = applyCachePolicy(
		{ messages, sessionId: "s1" },
		{ strategy: "anthropic-breakpoint", providerKey: "anthropic" }
	);
	// index 1 (the summary) carries the breakpoint; index 0 (system prompt) does NOT
	const summary = out.messages[1] as {
		providerOptions?: { anthropic?: { cacheControl?: unknown } };
	};
	const sysPrompt = out.messages[0] as {
		providerOptions?: { anthropic?: unknown };
	};
	expect(summary.providerOptions?.anthropic?.cacheControl).toMatchObject({
		type: "ephemeral",
	});
	expect(sysPrompt.providerOptions?.anthropic).toBeUndefined();
});
