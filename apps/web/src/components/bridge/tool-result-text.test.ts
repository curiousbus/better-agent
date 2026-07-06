import { expect, it } from "vitest";
import { flattenToolResult } from "./tool-result-text";

it("passes a plain string through unchanged", () => {
	expect(flattenToolResult("file.txt")).toBe("file.txt");
});

it("flattens the opencode content-array output shape", () => {
	const output = [
		{
			content: { text: "line one", type: "text" },
			type: "content",
		},
		{
			content: { text: "line two", type: "text" },
			type: "content",
		},
	];
	expect(flattenToolResult(output)).toBe("line one\n\nline two");
});

it("flattens the MCP content-envelope shape", () => {
	const output = {
		content: [
			{ text: "hello", type: "text" },
			{ text: "world", type: "text" },
		],
	};
	expect(flattenToolResult(output)).toBe("hello\n\nworld");
});

it("returns the empty string for an absent result rather than the text 'undefined'", () => {
	expect(flattenToolResult(undefined)).toBe("");
});

it("falls back to a JSON dump for an unrecognized shape", () => {
	expect(flattenToolResult({ cmd: "ls", exitCode: 0 })).toBe(
		JSON.stringify({ cmd: "ls", exitCode: 0 }, null, 2)
	);
});
