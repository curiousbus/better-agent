import { describe, expect, it } from "vitest";
import { normalizeClaudeCode } from "./claude-code";

describe("normalizeClaudeCode - system envelope", () => {
	it("maps a system/init line to a curated session_ready status", () => {
		const events = normalizeClaudeCode({
			type: "system",
			subtype: "init",
			session_id: "sess_1",
			model: "claude-opus-4-8",
			slash_commands: ["clear", "compact"],
			skills: ["pdf"],
		});
		expect(events).toEqual([
			{
				kind: "status",
				status: "session_ready",
				detail: {
					sessionId: "sess_1",
					model: "claude-opus-4-8",
					cwd: undefined,
					permissionMode: undefined,
					tools: undefined,
					slashCommands: ["clear", "compact"],
					skills: ["pdf"],
					mcpServers: undefined,
				},
			},
		]);
	});

	it("hides noisy system lines (hooks, thinking_tokens)", () => {
		expect(
			normalizeClaudeCode({ type: "system", subtype: "hook_started" })
		).toEqual([]);
		expect(
			normalizeClaudeCode({ type: "system", subtype: "thinking_tokens" })
		).toEqual([]);
	});
});

describe("normalizeClaudeCode - result envelope", () => {
	it("maps a result line to a curated turn_usage status", () => {
		const events = normalizeClaudeCode({
			type: "result",
			subtype: "success",
			total_cost_usd: 0.01,
			num_turns: 1,
			session_id: "sess_1",
		});
		expect(events).toEqual([
			{
				kind: "status",
				status: "turn_usage",
				detail: {
					costUsd: 0.01,
					numTurns: 1,
					durationMs: undefined,
					usage: undefined,
					isError: false,
				},
			},
		]);
	});
});

describe("normalizeClaudeCode - stream_event and edge cases", () => {
	it("maps a stream_event text_delta to an output event", () => {
		const events = normalizeClaudeCode({
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "text_delta", text: "ab" },
			},
		});
		expect(events).toEqual([{ kind: "output", text: "ab" }]);
	});

	it("ignores unrecognized envelope types", () => {
		expect(normalizeClaudeCode({ type: "nonsense" })).toEqual([]);
	});

	it("ignores non-object input", () => {
		expect(normalizeClaudeCode("just a string")).toEqual([]);
		expect(normalizeClaudeCode(null)).toEqual([]);
	});
});

describe("normalizeClaudeCode - assistant text and thinking blocks", () => {
	it("maps an assistant text block to a message event", () => {
		const events = normalizeClaudeCode({
			type: "assistant",
			message: { content: [{ type: "text", text: "hello there" }] },
		});
		expect(events).toEqual([
			{ kind: "message", role: "assistant", text: "hello there" },
		]);
	});

	it("maps a thinking block with the thinking flag set", () => {
		const events = normalizeClaudeCode({
			type: "assistant",
			message: { content: [{ type: "thinking", thinking: "pondering…" }] },
		});
		expect(events).toEqual([
			{
				kind: "message",
				role: "assistant",
				text: "pondering…",
				thinking: true,
			},
		]);
	});
});

describe("normalizeClaudeCode - assistant tool_use block", () => {
	it("fans an assistant turn with text + tool_use into two events", () => {
		const events = normalizeClaudeCode({
			type: "assistant",
			message: {
				content: [
					{ type: "text", text: "Let me check that file." },
					{
						type: "tool_use",
						id: "toolu_1",
						name: "Read",
						input: { file_path: "a.ts" },
					},
				],
			},
		});
		expect(events).toEqual([
			{ kind: "message", role: "assistant", text: "Let me check that file." },
			{
				kind: "tool",
				id: "toolu_1",
				name: "Read",
				status: "started",
				input: { file_path: "a.ts" },
			},
		]);
	});
});

describe("normalizeClaudeCode - user tool_result block", () => {
	it("maps a user tool_result block to a completed tool event", () => {
		const events = normalizeClaudeCode({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_1",
						content: "file contents",
					},
				],
			},
		});
		expect(events).toEqual([
			{
				kind: "tool",
				id: "toolu_1",
				name: "toolu_1",
				status: "completed",
				output: "file contents",
			},
		]);
	});

	it("marks a failed tool_result as failed", () => {
		const events = normalizeClaudeCode({
			type: "user",
			message: {
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_2",
						content: "boom",
						is_error: true,
					},
				],
			},
		});
		expect(events[0]).toMatchObject({ status: "failed" });
	});
});
