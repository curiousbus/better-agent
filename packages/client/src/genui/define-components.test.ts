import { describe, expect, it } from "vitest";
import { type ComponentDef, defineComponents } from "./define-components";

const DEFS: ComponentDef[] = [
	{
		type: "Card",
		description: "A titled container.",
		props: { type: "object", properties: { title: { type: "string" } } },
		children: true,
	},
	{
		type: "Button",
		description: "A clickable button.",
		props: { type: "object", properties: { label: { type: "string" } } },
		actions: ["press"],
	},
];

interface SchemaBranch {
	description: string;
	properties: {
		action?: { properties: { intent: { enum: string[] } } };
		children?: { items: { anyOf: SchemaBranch[] } };
		type: { const: string };
	};
}

interface DerivedSchema {
	properties: { root: { anyOf: SchemaBranch[] } };
	required: string[];
	type: string;
}

describe("defineComponents", () => {
	it("derives a self-contained bounded-depth UINode union (no $ref)", () => {
		const ui = defineComponents(DEFS);
		const schema = ui.outputSchema as unknown as DerivedSchema;
		expect(schema.type).toBe("object");
		expect(schema.required).toContain("root");
		// No $ref/$defs — recursive refs are inlined so any provider accepts it.
		expect(JSON.stringify(schema)).not.toContain("$ref");
		const branches = schema.properties.root.anyOf;
		expect(branches).toHaveLength(DEFS.length);
		const card = branches.find((b) => b.properties.type.const === "Card");
		expect(card?.description).toBe("A titled container.");
		// children inline the union again (one level deeper), not a $ref.
		expect(card?.properties.children?.items.anyOf).toHaveLength(DEFS.length);
		const button = branches.find((b) => b.properties.type.const === "Button");
		expect(button?.properties.children).toBeUndefined();
		expect(button?.properties.action?.properties.intent.enum).toEqual([
			"press",
		]);
	});

	it("validate narrows a well-formed tree and reads .root", () => {
		const ui = defineComponents(DEFS);
		const tree = ui.validate({
			root: { id: "a", type: "Card", props: { title: "Hi" }, children: [] },
		});
		expect(tree?.type).toBe("Card");
	});

	it("validate rejects unknown types and malformed nodes", () => {
		const ui = defineComponents(DEFS);
		expect(
			ui.validate({ root: { id: "a", type: "Nope", props: {} } })
		).toBeNull();
		expect(ui.validate({ root: { type: "Card", props: {} } })).toBeNull();
		expect(ui.validate(null)).toBeNull();
	});
});
