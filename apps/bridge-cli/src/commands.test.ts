import type { Mock } from "vitest";
import { describe, expect, it, vi } from "vitest";
import type { CommandSink } from "./commands";
import { dispatchCommands, parseCommandText } from "./commands";

describe("parseCommandText", () => {
	it("accepts a bare string as a text command", () => {
		expect(parseCommandText("go")).toEqual({ type: "text", text: "go" });
	});

	it("accepts an object with a text field as a text command", () => {
		expect(parseCommandText({ text: "go" })).toEqual({
			type: "text",
			text: "go",
		});
	});

	it("accepts an approval command", () => {
		expect(
			parseCommandText({
				type: "approval",
				requestId: "req_1",
				optionId: "allow",
			})
		).toEqual({ type: "approval", requestId: "req_1", optionId: "allow" });
	});

	it("rejects an approval object missing requestId/optionId", () => {
		expect(
			parseCommandText({ type: "approval", requestId: "req_1" })
		).toBeNull();
	});

	it("accepts a control:stop command", () => {
		expect(parseCommandText({ type: "control", action: "stop" })).toEqual({
			type: "control",
			action: "stop",
		});
	});

	it("rejects a control command with an unrecognized action", () => {
		expect(parseCommandText({ type: "control", action: "pause" })).toBeNull();
	});

	it("rejects anything else", () => {
		expect(parseCommandText(42)).toBeNull();
		expect(parseCommandText(null)).toBeNull();
		expect(parseCommandText({ other: "go" })).toBeNull();
	});
});

// Cross-boundary regression: apps/web/src/components/bridge/
// use-bridge-terminal.ts's `makeAnswerApproval` sends its decision as
// `transport.sendInput({ sessionId, data: { type: "approval", requestId,
// optionId } })` — an object, never `JSON.stringify`'d. These two cases pin
// down why: the string check in `parseCommandText` runs first, so a
// stringified approval is indistinguishable from plain chat text and would
// never reach `answerApproval`, leaving the approval stalled forever. Split
// out of the `describe("parseCommandText", ...)` block above to stay under
// this repo's max-lines-per-function gate.
describe("parseCommandText web/CLI approval boundary", () => {
	it("routes the exact object the web sends to an approval command, not text", () => {
		const webApprovalPayload = {
			type: "approval",
			requestId: "req-1",
			optionId: "allow",
		};

		expect(parseCommandText(webApprovalPayload)).toEqual({
			type: "approval",
			requestId: "req-1",
			optionId: "allow",
		});
	});

	it("treats a JSON.stringify'd approval payload as plain text, not a command", () => {
		const stringifiedApprovalPayload = JSON.stringify({
			type: "approval",
			requestId: "req-1",
			optionId: "allow",
		});

		expect(parseCommandText(stringifiedApprovalPayload)).toEqual({
			type: "text",
			text: stringifiedApprovalPayload,
		});
	});
});

describe("dispatchCommands", () => {
	function fakeSink(): CommandSink & { stop: Mock<() => void> } {
		return { answerApproval: vi.fn(), send: vi.fn(), stop: vi.fn() };
	}

	it("calls sink.stop and reports stopRequested for a control:stop command", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		const result = dispatchCommands(
			[{ id: 7, data: { type: "control", action: "stop" } }],
			sink,
			afterIdRef
		);

		expect(sink.stop).toHaveBeenCalledTimes(1);
		expect(sink.send).not.toHaveBeenCalled();
		expect(result).toEqual({ wasActive: true, stopRequested: true });
		expect(afterIdRef.current).toBe(7);
	});

	it("never sets stopRequested for ordinary text/approval commands", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		const result = dispatchCommands([{ id: 1, data: "go" }], sink, afterIdRef);

		expect(result).toEqual({ wasActive: true, stopRequested: false });
	});

	it("reports stopRequested: false and wasActive: false when no commands are seen", () => {
		const sink = fakeSink();
		const afterIdRef = { current: 0 };

		expect(dispatchCommands([], sink, afterIdRef)).toEqual({
			wasActive: false,
			stopRequested: false,
		});
	});
});
