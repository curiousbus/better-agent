import { expect, it } from "vitest";
import { AGENT_KIND, ALICE, build } from "./bridge-test-helpers";

// Server-side size caps for the local agent bridge (spec §3.1: truncate
// oversized lines + bound the window). See packages/api/src/routers/bridge.ts
// for MAX_PUSH_BATCH / MAX_EVENT_BYTES / MAX_INPUT_CHARS.

const OVER_BATCH_LIMIT = 51;
const BYTES_PER_KB = 1024;
const OVERSIZED_EVENT_KB = 40;
const OVERSIZED_INPUT_KB = 10;
const OVERSIZED_EVENT_BYTES = OVERSIZED_EVENT_KB * BYTES_PER_KB;
const OVERSIZED_INPUT_CHARS = OVERSIZED_INPUT_KB * BYTES_PER_KB;

async function startSession() {
	const { bridgeClientFor, userClientFor } = build();
	const cli = bridgeClientFor({ tokenId: "tok-1", userId: ALICE.id });
	const { sessionId } = await cli.bridge.startSession({
		agentKind: AGENT_KIND,
	});
	return { cli, sessionId, alice: userClientFor(ALICE) };
}

it("pushEvents rejects a batch of 51 events with BAD_REQUEST", async () => {
	const { cli, sessionId } = await startSession();
	const events = Array.from({ length: OVER_BATCH_LIMIT }, (_, i) => ({ i }));

	await expect(
		cli.bridge.pushEvents({ sessionId, events })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("pushEvents accepts a batch at the cap (50 events)", async () => {
	const { cli, sessionId } = await startSession();
	const events = Array.from({ length: OVER_BATCH_LIMIT - 1 }, (_, i) => ({
		i,
	}));

	await expect(cli.bridge.pushEvents({ sessionId, events })).resolves.toEqual({
		ok: true,
	});
});

it("pushEvents rejects a single event over the byte size cap with BAD_REQUEST", async () => {
	const { cli, sessionId } = await startSession();
	const oversizedEvent = { chunk: "x".repeat(OVERSIZED_EVENT_BYTES) };

	await expect(
		cli.bridge.pushEvents({ sessionId, events: [oversizedEvent] })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});

it("sendInput rejects a data string over the char cap with BAD_REQUEST", async () => {
	const { sessionId, alice } = await startSession();
	const oversizedInput = "x".repeat(OVERSIZED_INPUT_CHARS);

	await expect(
		alice.bridge.sendInput({ sessionId, data: oversizedInput })
	).rejects.toMatchObject({ code: "BAD_REQUEST" });
});
