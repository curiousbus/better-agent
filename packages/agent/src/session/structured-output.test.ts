import { expect, it } from "vitest";
import {
	buildStructuredOutputToolDef,
	STRUCTURED_OUTPUT_TOOL_NAME,
} from "./structured-output";

it("builds a no-op tool whose parameters are the output schema", async () => {
	const schema = { type: "object", properties: { n: { type: "number" } } };
	const def = buildStructuredOutputToolDef(schema);
	expect(def.name).toBe(STRUCTURED_OUTPUT_TOOL_NAME);
	expect(def.parameters).toBe(schema);
	await expect(def.execute({ n: 1 }, {} as never)).resolves.toEqual({
		output: "",
	});
});
