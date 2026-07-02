import type { RunEvent } from "@better-agent/agent/session/events";
import { expect, it } from "vitest";
import { createTurnChannel, pumpTurn } from "./turn-channel";

const errorEvent = (error: unknown): RunEvent => ({
	type: "error",
	message: String(error),
});

function makeTurn(sideEffects: string[]): AsyncGenerator<RunEvent, void> {
	// biome-ignore lint/suspicious/useAwait: test async generator
	return (async function* turn() {
		yield { type: "text-delta", delta: "a" } as RunEvent;
		sideEffects.push("mid");
		yield { type: "text-delta", delta: "b" } as RunEvent;
		yield { type: "done", usage: null, finishReason: "stop" } as RunEvent;
		sideEffects.push("finalized");
	})();
}

it("the pump runs the turn to completion even when the observer stops early", async () => {
	const sideEffects: string[] = [];
	const channel = createTurnChannel();
	const pump = pumpTurn(makeTurn(sideEffects), channel, errorEvent);

	// Observer reads ONE event then abandons (simulates a client disconnect).
	for await (const event of channel.observe()) {
		expect(event.type).toBe("text-delta");
		break;
	}

	await pump;
	expect(sideEffects).toEqual(["mid", "finalized"]);
});

it("a late observer still sees the full buffered event log", async () => {
	const sideEffects: string[] = [];
	const channel = createTurnChannel();
	await pumpTurn(makeTurn(sideEffects), channel, errorEvent);

	const seen: string[] = [];
	for await (const event of channel.observe()) {
		seen.push(event.type);
	}
	expect(seen).toEqual(["text-delta", "text-delta", "done"]);
});

it("a thrown turn surfaces as an error event and still closes the channel", async () => {
	const channel = createTurnChannel();
	// biome-ignore lint/suspicious/useAwait: test async generator
	const boom = (async function* turn(): AsyncGenerator<RunEvent, void> {
		yield { type: "text-delta", delta: "x" } as RunEvent;
		throw new Error("model exploded");
	})();
	await pumpTurn(boom, channel, errorEvent);

	const seen: RunEvent[] = [];
	for await (const event of channel.observe()) {
		seen.push(event);
	}
	expect(seen.at(-1)?.type).toBe("error");
});
