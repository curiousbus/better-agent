import { describe, expect, it } from "vitest";
import { parseCommandText } from "./commands";

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

	it("rejects anything else", () => {
		expect(parseCommandText(42)).toBeNull();
		expect(parseCommandText(null)).toBeNull();
		expect(parseCommandText({ other: "go" })).toBeNull();
	});
});
