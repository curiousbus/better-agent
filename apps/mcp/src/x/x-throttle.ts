import { XAuthError, XNotFoundError, XRateLimitError } from "./x-errors";

// X aggressively rate-limits / bans bursty scraping. Two defenses:
//   1. A per-isolate SERIAL QUEUE with a minimum gap between calls — concurrent
//      tool calls landing on the same Worker isolate run one at a time, spaced
//      out, instead of hammering X in parallel.
//   2. EXPONENTIAL BACKOFF on transient failures (rate limits / network), so a
//      throttled call waits and retries rather than failing (or retrying
//      instantly, which gets the token banned).
// Cross-isolate bursts still exist (Workers has no shared state here), but this
// removes the dominant same-isolate parallelism and instant-retry patterns.

const MIN_GAP_MS = 800;
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 8000;

let chain: Promise<unknown> = Promise.resolve();
let lastRunAt = 0;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Permanent failures — never retry (retrying an expired token or a 404 just
// wastes the token's rate budget).
function isPermanent(err: unknown): boolean {
	return err instanceof XAuthError || err instanceof XNotFoundError;
}

function backoffMs(attempt: number): number {
	return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
}

async function withBackoff<T>(fn: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (isPermanent(err) || attempt === MAX_ATTEMPTS) {
				throw err;
			}
			// Rate-limit errors get a longer wait than generic transient ones.
			const factor = err instanceof XRateLimitError ? 2 : 1;
			await sleep(backoffMs(attempt) * factor);
		}
	}
	throw lastError;
}

async function spacedRun<T>(fn: () => Promise<T>): Promise<T> {
	const wait = MIN_GAP_MS - (Date.now() - lastRunAt);
	if (wait > 0) {
		await sleep(wait);
	}
	try {
		return await withBackoff(fn);
	} finally {
		lastRunAt = Date.now();
	}
}

/**
 * Enqueue an X operation: serialized per isolate with a minimum gap, and
 * retried with exponential backoff on transient/rate-limit failures.
 */
export function throttleX<T>(fn: () => Promise<T>): Promise<T> {
	const run = chain.then(() => spacedRun(fn));
	// Keep the chain alive even if this run rejects, so one failure doesn't
	// wedge every later call.
	chain = run.then(
		() => undefined,
		() => undefined
	);
	return run;
}
