import { expect, it } from "vitest";
import { buildTools } from "./registry";
import type { ToolDef } from "./types";

const DUPLICATE_NAME_RE = /duplicate/i;

const ctxBase = {
	sessionId: "s1",
	messageId: "m1",
	agentId: "a1",
	abortSignal: new AbortController().signal,
};

function echoTool(over?: Partial<ToolDef>): ToolDef {
	return {
		name: "echo",
		description: "echo the input",
		parameters: { type: "object", properties: { v: { type: "string" } } },
		execute: ({ v }: { v: string } | never) =>
			Promise.resolve({ output: `echo:${(v as string) ?? ""}` }),
		...over,
	};
}

it("adapts a ToolDef into an AI-SDK tool whose execute runs the def", async () => {
	const tools = buildTools([echoTool()], ctxBase);
	expect(Object.keys(tools)).toEqual(["echo"]);
	// AI-SDK tool execute signature: execute(args, options)
	const echo = tools.echo;
	if (!echo?.execute) {
		throw new Error("missing tool or execute: echo");
	}
	const out = await echo.execute(
		{ v: "hi" },
		{ toolCallId: "c1", messages: [] }
	);
	expect(out).toBe("echo:hi");
});

it("truncates very large tool output", async () => {
	const big = echoTool({
		execute: () => Promise.resolve({ output: "x".repeat(60_000) }),
	});
	const tools = buildTools([big], ctxBase);
	const echo = tools.echo;
	if (!echo?.execute) {
		throw new Error("missing tool or execute: echo");
	}
	const out = (await echo.execute(
		{ v: "" },
		{ toolCallId: "c1", messages: [] }
	)) as string;
	expect(out).toContain("truncated");
});

it("throws on duplicate tool names", () => {
	expect(() => buildTools([echoTool(), echoTool()], ctxBase)).toThrow(
		DUPLICATE_NAME_RE
	);
});
