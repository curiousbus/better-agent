import type { ErrorCategory, FinishReason, MessageUsage } from "./types";

export const MAX_LLM_ATTEMPTS = 3;
export const BASE_BACKOFF_MS = 500;

export interface StreamOutcome {
	emittedOutput: boolean;
	errorCategory: ErrorCategory | null;
	errorMessage: string | null;
	finishReason: FinishReason;
	status: "complete" | "error" | "aborted";
	structured: unknown;
	usage: MessageUsage | null;
}

export function defaultSleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

export function backoffMs(attempt: number): number {
	return BASE_BACKOFF_MS * 2 ** (attempt - 1);
}

export function resetOutcome(state: StreamOutcome): void {
	state.usage = null;
	state.finishReason = "stop";
	state.status = "complete";
	state.errorMessage = null;
	state.errorCategory = null;
	state.emittedOutput = false;
	state.structured = null;
}

export function shouldRetryAttempt(
	state: StreamOutcome,
	attempt: number,
	aborted: boolean
): boolean {
	return (
		state.status === "error" &&
		!state.emittedOutput &&
		state.errorCategory === "retryable" &&
		attempt < MAX_LLM_ATTEMPTS &&
		!aborted
	);
}
