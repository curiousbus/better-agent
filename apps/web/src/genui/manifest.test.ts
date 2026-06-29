import { defineComponents } from "@curiousbus/agent-client";
import { expect, it } from "vitest";
import { COMPONENT_TYPES, MANIFEST } from "./manifest";

interface UINodeSchema {
	anyOf: unknown[];
}

interface OutputSchema {
	$defs: { UINode: UINodeSchema };
}

it("compiles into a schema with one branch per component", () => {
	const ui = defineComponents(MANIFEST);
	const schema = ui.outputSchema as unknown as OutputSchema;
	expect(schema.$defs.UINode.anyOf).toHaveLength(MANIFEST.length);
	expect(new Set(ui.types)).toEqual(new Set(COMPONENT_TYPES));
});

it("marks containers with children and Button/Form with actions", () => {
	const byType = new Map(MANIFEST.map((d) => [d.type, d]));
	expect(byType.get("Stack")?.children).toBe(true);
	expect(byType.get("Card")?.children).toBe(true);
	expect(byType.get("Button")?.actions).toContain("press");
	expect(byType.get("Form")?.actions).toContain("submit");
});
