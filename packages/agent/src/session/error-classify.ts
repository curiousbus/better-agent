import type { ErrorCategory } from "./types";

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_PATTERNS = [
	"timeout",
	"timed out",
	"econnreset",
	"econnrefused",
	"network",
	"fetch failed",
	"overloaded",
	"rate limit",
];

interface MaybeApiError {
	isRetryable?: unknown;
	message?: unknown;
	name?: unknown;
	statusCode?: unknown;
}

function asError(error: unknown): MaybeApiError {
	return typeof error === "object" && error !== null
		? (error as MaybeApiError)
		: {};
}

export function classifyError(error: unknown): ErrorCategory {
	const e = asError(error);
	if (e.name === "AbortError" || e.name === "TimeoutError") {
		return "aborted";
	}
	const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
	if (
		message.includes("content filter") ||
		message.includes("content_filter")
	) {
		return "content-filter";
	}
	if (typeof e.statusCode === "number" && RETRYABLE_STATUS.has(e.statusCode)) {
		return "retryable";
	}
	if (e.isRetryable === true) {
		return "retryable";
	}
	if (RETRYABLE_PATTERNS.some((pattern) => message.includes(pattern))) {
		return "retryable";
	}
	return "fatal";
}
