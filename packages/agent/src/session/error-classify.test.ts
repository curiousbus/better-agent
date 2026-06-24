import { expect, it } from "vitest";
import { classifyError } from "./error-classify";

it("classifies retryable HTTP statuses as retryable", () => {
	expect(classifyError({ statusCode: 429 })).toBe("retryable");
	expect(classifyError({ statusCode: 503 })).toBe("retryable");
	expect(classifyError({ statusCode: 500 })).toBe("retryable");
});

it("classifies client errors as fatal", () => {
	expect(classifyError({ statusCode: 400 })).toBe("fatal");
	expect(classifyError({ statusCode: 401 })).toBe("fatal");
	expect(classifyError(new Error("nonsense"))).toBe("fatal");
});

it("classifies network/timeout/overloaded messages as retryable", () => {
	expect(classifyError(new Error("fetch failed"))).toBe("retryable");
	expect(classifyError(new Error("request timeout"))).toBe("retryable");
	expect(classifyError(new Error("Overloaded"))).toBe("retryable");
});

it("classifies abort errors as aborted", () => {
	expect(classifyError({ name: "AbortError" })).toBe("aborted");
	expect(classifyError({ name: "TimeoutError" })).toBe("aborted");
});

it("classifies content-filter errors as content-filter", () => {
	expect(classifyError(new Error("content filter triggered"))).toBe(
		"content-filter"
	);
});

it("honors an explicit isRetryable flag", () => {
	expect(classifyError({ isRetryable: true })).toBe("retryable");
	expect(classifyError({ statusCode: 400, isRetryable: true })).toBe(
		"retryable"
	);
});
