import { expect, it } from "vitest";
import { drainStream } from "./runtime-drain";
import { STRUCTURED_OUTPUT_TOOL_NAME } from "./structured-output";

function fakeBufs() {
	const noop = () => Promise.resolve();
	return {
		text: { append: noop, finishStep: noop },
		reasoning: { append: noop, finishStep: noop },
	} as never;
}

function fakeCtx() {
	return {
		agentId: "a",
		assistantId: "m",
		sessionId: "s",
		toolDefs: [],
		messageStore: { appendPart: () => Promise.resolve() },
	} as never;
}

function* chunks(items: unknown[]): Generator<unknown> {
	for (const c of items) {
		yield c;
	}
}

async function collect(items: unknown[]) {
	const out: { type: string; partial?: unknown }[] = [];
	const state = {} as never;
	const result = { fullStream: chunks(items) } as never;
	for await (const ev of drainStream(result, fakeBufs(), state, fakeCtx())) {
		out.push(ev as never);
	}
	return out;
}

it("surfaces growing structured-delta partials for StructuredOutput", async () => {
	const events = await collect([
		{
			type: "tool-input-start",
			toolCallId: "c1",
			toolName: STRUCTURED_OUTPUT_TOOL_NAME,
		},
		{
			type: "tool-input-delta",
			toolCallId: "c1",
			inputTextDelta: '{"root":{"id":"x"',
		},
		{
			type: "tool-input-delta",
			toolCallId: "c1",
			inputTextDelta: ',"type":"Card"}}',
		},
	]);
	const deltas = events.filter((e) => e.type === "structured-delta");
	expect(deltas).toHaveLength(2);
	expect(deltas[1]?.partial).toEqual({ root: { id: "x", type: "Card" } });
});

it("ignores tool-input deltas from other tools", async () => {
	const events = await collect([
		{ type: "tool-input-start", toolCallId: "c2", toolName: "echo" },
		{ type: "tool-input-delta", toolCallId: "c2", inputTextDelta: '{"x":1}' },
	]);
	expect(events.filter((e) => e.type === "structured-delta")).toHaveLength(0);
});
