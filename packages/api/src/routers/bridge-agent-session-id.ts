import { log } from "evlog";
import type { Context } from "../context";

// Split out of bridge.ts purely to keep that file under the repo's
// max-lines-per-file gate — see bridge-agent-session-id.test.ts.

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pulls claude's own conversation id off a curated `session_ready` status
 * event — `{kind:"status", status:"session_ready", detail:{sessionId}}`, as
 * emitted by the CLI's normalize layer (see
 * `apps/bridge-cli/src/normalize/claude-code.ts`'s `sessionInfo`) — or `null`
 * for any other event shape. */
function extractAgentSessionId(event: unknown): string | null {
	if (
		!isRecord(event) ||
		event.kind !== "status" ||
		event.status !== "session_ready"
	) {
		return null;
	}
	const detail = event.detail;
	return isRecord(detail) && typeof detail.sessionId === "string"
		? detail.sessionId
		: null;
}

/** Best-effort: records the underlying local agent's own conversation id
 * (claude's `session_id`) onto the bridge session row the first time a
 * `session_ready` event is pushed. Never throws — a failure here must not
 * break the live relay, same rationale as `persistEventBestEffort` in
 * bridge.ts. */
export async function maybePersistAgentSessionId(
	context: Context,
	sessionId: string,
	event: unknown
): Promise<void> {
	const agentSessionId = extractAgentSessionId(event);
	if (agentSessionId === null) {
		return;
	}
	try {
		await context.services.stores.bridgeSession.setAgentSessionId(
			sessionId,
			agentSessionId
		);
	} catch (err) {
		log.error({
			action: "bridge pushEvents setAgentSessionId",
			error: String(err),
		});
	}
}
