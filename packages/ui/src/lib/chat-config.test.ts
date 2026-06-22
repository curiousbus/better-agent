import { describe, expect, it } from "vitest";

import {
	COMFORTABLE_CONFIG,
	COMPACT_CONFIG,
	resolveDensityTokens,
} from "./chat-config";

describe("resolveDensityTokens", () => {
	it("centers and widens prose for comfortable density", () => {
		const tokens = resolveDensityTokens("comfortable");
		expect(tokens.thread).toContain("max-w-3xl");
		expect(tokens.thread).toContain("mx-auto");
		expect(tokens.metaText).toBe("hidden");
	});

	it("uses full width and a mono meta strip for compact density", () => {
		const tokens = resolveDensityTokens("compact");
		expect(tokens.thread).toContain("max-w-none");
		expect(tokens.metaText).toContain("font-mono");
	});
});

describe("default configs", () => {
	it("hides internals in comfortable mode", () => {
		expect(COMFORTABLE_CONFIG.density).toBe("comfortable");
		expect(COMFORTABLE_CONFIG.showMeta).toBe(false);
		expect(COMFORTABLE_CONFIG.showReasoning).toBe("collapsed");
		expect(COMFORTABLE_CONFIG.showToolDetail).toBe("summary");
	});

	it("exposes internals in compact mode", () => {
		expect(COMPACT_CONFIG.density).toBe("compact");
		expect(COMPACT_CONFIG.showMeta).toBe(true);
		expect(COMPACT_CONFIG.showReasoning).toBe("expanded");
		expect(COMPACT_CONFIG.showToolDetail).toBe("raw");
	});
});
