// Fetch-based text/event-stream consumer for the bridge's plain-Hono
// `/bridge/sessions/:id/stream` route. A native EventSource can't attach the
// bearer auth header this app uses (see apps/web/src/utils/orpc.ts), so the
// stream is read manually: fetch the URL, pump the response body through
// createSseParser, and hand parsed frames to the caller.

import { env } from "@better-agent/env/web";
import { getAccessToken } from "@/utils/auth";
import { redirectToLogin, refreshAccessToken } from "@/utils/orpc";
import { createSseParser } from "./sse-parser";

const HTTP_UNAUTHORIZED = 401;

export interface StreamHandlers {
	onError: () => void;
	onEvent: (raw: { data: unknown; id: number }) => void;
	onOpen: () => void;
}

function streamUrl(sessionId: string, afterId: number): string {
	return `${env.VITE_SERVER_URL}/bridge/sessions/${sessionId}/stream?afterId=${afterId}`;
}

function fetchStream(url: string, signal: AbortSignal): Promise<Response> {
	const token = getAccessToken();
	return fetch(url, {
		headers: token ? { authorization: `Bearer ${token}` } : {},
		signal,
	});
}

// Retries once, after a token refresh, on a 401 — mirroring the oRPC link's
// interceptor (see orpc.ts) since this fetch bypasses that link entirely.
async function openStream(
	url: string,
	signal: AbortSignal
): Promise<Response | null> {
	let response = await fetchStream(url, signal);
	if (response.status === HTTP_UNAUTHORIZED) {
		const refreshed = await refreshAccessToken();
		if (!refreshed) {
			redirectToLogin();
			return null;
		}
		response = await fetchStream(url, signal);
	}
	return response.ok ? response : null;
}

async function pumpBody(
	response: Response,
	handlers: StreamHandlers,
	signal: AbortSignal
): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) {
		handlers.onError();
		return;
	}
	const decoder = new TextDecoder();
	const parser = createSseParser();
	handlers.onOpen();
	while (!signal.aborted) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		for (const raw of parser.feed(decoder.decode(value, { stream: true }))) {
			try {
				handlers.onEvent({ id: raw.id, data: JSON.parse(raw.data) });
			} catch {
				// malformed frame: drop it rather than crash the reader loop
			}
		}
	}
	// The server holds this connection open (heartbeats every 15s) — the body
	// ending at all, absent an intentional abort, means the connection dropped.
	if (!signal.aborted) {
		handlers.onError();
	}
}

/** Opens the stream and starts pumping it; returns an abort function. */
export function connectBridgeStream(
	sessionId: string,
	afterId: number,
	handlers: StreamHandlers
): () => void {
	const controller = new AbortController();
	(async () => {
		try {
			const response = await openStream(
				streamUrl(sessionId, afterId),
				controller.signal
			);
			if (!response) {
				if (!controller.signal.aborted) {
					handlers.onError();
				}
				return;
			}
			await pumpBody(response, handlers, controller.signal);
		} catch {
			if (!controller.signal.aborted) {
				handlers.onError();
			}
		}
	})();
	return () => controller.abort();
}
