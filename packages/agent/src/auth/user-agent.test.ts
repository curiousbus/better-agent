import { expect, it } from "vitest";
import { parseUserAgent } from "./user-agent";

it("parses Chrome on macOS", () => {
	const ua =
		"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
	expect(parseUserAgent(ua)).toBe("Chrome · macOS");
});

it("parses Safari on iOS (iPhone)", () => {
	const ua =
		"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
	expect(parseUserAgent(ua)).toBe("Safari · iOS");
});

it("returns Unknown device for null", () => {
	expect(parseUserAgent(null)).toBe("Unknown device");
});

it("Edge wins over Chrome when both tokens appear in UA", () => {
	const ua =
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
	expect(parseUserAgent(ua)).toBe("Edge · Windows");
});

it("returns Unknown device for empty string", () => {
	expect(parseUserAgent("")).toBe("Unknown device");
});

it("parses Firefox on Linux", () => {
	const ua =
		"Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0";
	expect(parseUserAgent(ua)).toBe("Firefox · Linux");
});
