import { describe, expect, it } from "vitest";
import {
	buildPiGetCommandsCommand,
	buildPiGetStateCommand,
	buildPiPromptCommand,
	normalizePi,
	normalizePiCommandsResponse,
	normalizePiStateModel,
} from "./pi";

describe("normalizePi - message_update text_delta", () => {
	it("maps a text_delta assistantMessageEvent to an output event", () => {
		const events = normalizePi({
			type: "message_update",
			message: {},
			assistantMessageEvent: { type: "text_delta", delta: "Hello " },
		});
		expect(events).toEqual([{ kind: "output", text: "Hello " }]);
	});

	it("ignores non-text_delta assistantMessageEvent subtypes", () => {
		expect(
			normalizePi({
				type: "message_update",
				assistantMessageEvent: { type: "thinking_delta", delta: "hmm" },
			})
		).toEqual([]);
	});
});

describe("normalizePi - message_end", () => {
	it("drops the final text block (already streamed) but keeps thinking", () => {
		const events = normalizePi({
			type: "message_end",
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "Done." },
					{ type: "thinking", thinking: "pondering…" },
					{ type: "toolCall", id: "call_1", name: "bash", arguments: {} },
				],
			},
		});
		// The text streamed live via message_update text_delta, so the final
		// text block is dropped to avoid rendering the reply twice; thinking
		// (not streamed) is kept.
		expect(events).toEqual([
			{
				kind: "message",
				role: "assistant",
				text: "pondering…",
				thinking: true,
			},
		]);
	});

	it("ignores non-assistant messages", () => {
		expect(
			normalizePi({
				type: "message_end",
				message: { role: "user", content: "hi" },
			})
		).toEqual([]);
	});

	it("maps a plain string assistant message body", () => {
		expect(
			normalizePi({
				type: "message_end",
				message: { role: "assistant", content: "plain text" },
			})
		).toEqual([{ kind: "message", role: "assistant", text: "plain text" }]);
	});
});

describe("normalizePi - tool_execution_start", () => {
	it("maps tool_execution_start to a started tool event", () => {
		const events = normalizePi({
			type: "tool_execution_start",
			toolCallId: "call_1",
			toolName: "bash",
			args: { command: "ls" },
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "bash",
				status: "started",
				input: { command: "ls" },
			},
		]);
	});
});

describe("normalizePi - tool_execution_end", () => {
	it("maps tool_execution_end with isError to a failed tool event", () => {
		const events = normalizePi({
			type: "tool_execution_end",
			toolCallId: "call_1",
			toolName: "bash",
			result: "boom",
			isError: true,
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "bash",
				status: "failed",
				output: "boom",
			},
		]);
	});

	it("maps tool_execution_end without isError to a completed tool event", () => {
		const events = normalizePi({
			type: "tool_execution_end",
			toolCallId: "call_1",
			toolName: "bash",
			result: "ok",
			isError: false,
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "call_1",
				name: "bash",
				status: "completed",
				output: "ok",
			},
		]);
	});
});

describe("normalizePi - lifecycle status passthrough", () => {
	it("maps agent_start/agent_end/turn_start/turn_end to status events", () => {
		expect(normalizePi({ type: "agent_start" })).toEqual([
			{
				kind: "status",
				status: "agent_start",
				detail: { type: "agent_start" },
			},
		]);
		expect(
			normalizePi({ type: "turn_end", message: {}, toolResults: [] })
		).toEqual([
			{
				kind: "status",
				status: "turn_end",
				detail: { type: "turn_end", message: {}, toolResults: [] },
			},
		]);
	});
});

describe("normalizePi - response failures", () => {
	it("maps a success:false response to an error event", () => {
		const events = normalizePi({
			type: "response",
			command: "set_model",
			success: false,
			id: "req-1",
			error: "Model not found",
		});
		expect(events).toEqual([
			{ kind: "error", message: "Model not found", detail: "Model not found" },
		]);
	});

	it("ignores a successful response", () => {
		expect(
			normalizePi({
				type: "response",
				command: "prompt",
				success: true,
				id: "req-1",
			})
		).toEqual([]);
	});
});

describe("normalizePi - edge cases", () => {
	it("ignores unrecognized event types", () => {
		expect(normalizePi({ type: "nonsense" })).toEqual([]);
	});

	it("ignores non-object input", () => {
		expect(normalizePi("just a string")).toEqual([]);
		expect(normalizePi(null)).toEqual([]);
	});
});

describe("buildPiPromptCommand", () => {
	it("builds a prompt command frame", () => {
		const frame = buildPiPromptCommand("continue please");
		expect(JSON.parse(frame)).toEqual({
			type: "prompt",
			message: "continue please",
		});
	});
});

describe("buildPiGetCommandsCommand / buildPiGetStateCommand", () => {
	it("builds the get_commands and get_state command frames", () => {
		expect(JSON.parse(buildPiGetCommandsCommand())).toEqual({
			type: "get_commands",
		});
		expect(JSON.parse(buildPiGetStateCommand())).toEqual({ type: "get_state" });
	});
});

describe("normalizePiCommandsResponse", () => {
	it("splits get_commands' flat list into slashCommands and skills", () => {
		const result = normalizePiCommandsResponse({
			type: "response",
			command: "get_commands",
			success: true,
			data: {
				commands: [
					{ name: "session-name", source: "extension" },
					{ name: "fix-tests", source: "prompt" },
					{ name: "skill:brave-search", source: "skill" },
				],
			},
		});
		expect(result).toEqual({
			slashCommands: ["session-name", "fix-tests", "skill:brave-search"],
			skills: ["brave-search"],
		});
	});

	it("returns null for a response to a different command", () => {
		expect(
			normalizePiCommandsResponse({
				type: "response",
				command: "get_state",
				success: true,
				data: {},
			})
		).toBeNull();
	});

	it("returns null for a failed get_commands response, or non-response input", () => {
		expect(
			normalizePiCommandsResponse({
				type: "response",
				command: "get_commands",
				success: false,
				error: "boom",
			})
		).toBeNull();
		expect(normalizePiCommandsResponse({ type: "agent_start" })).toBeNull();
		expect(normalizePiCommandsResponse(null)).toBeNull();
	});
});

describe("normalizePiStateModel", () => {
	it("extracts the model id from a get_state response", () => {
		const model = normalizePiStateModel({
			type: "response",
			command: "get_state",
			success: true,
			data: {
				model: { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
			},
		});
		expect(model).toBe("claude-sonnet-4-20250514");
	});

	it("falls back to the model name when there's no id", () => {
		const model = normalizePiStateModel({
			type: "response",
			command: "get_state",
			success: true,
			data: { model: { name: "Claude Sonnet 4" } },
		});
		expect(model).toBe("Claude Sonnet 4");
	});

	it("is undefined when data.model is null, or the response is for a different command", () => {
		expect(
			normalizePiStateModel({
				type: "response",
				command: "get_state",
				success: true,
				data: { model: null },
			})
		).toBeUndefined();
		expect(
			normalizePiStateModel({
				type: "response",
				command: "get_commands",
				success: true,
				data: { commands: [] },
			})
		).toBeUndefined();
	});
});
