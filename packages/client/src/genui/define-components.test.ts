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
		children?: { items: { $ref: string } };
		type: { const: string };
	};
}

interface DerivedSchema {
	$defs: { UINode: { anyOf: SchemaBranch[] } };
	properties: { root: { $ref: string } };
	required: string[];
	type: string;
}

describe("defineComponents", () => {
	it("derives an object schema wrapping a recursive UINode union", () => {
		const ui = defineComponents(DEFS);
		const schema = ui.outputSchema as unknown as DerivedSchema;
		expect(schema.type).toBe("object");
		expect(schema.properties.root.$ref).toBe("#/$defs/UINode");
		expect(schema.required).toContain("root");
		const branches = schema.$defs.UINode.anyOf;
		expect(branches).toHaveLength(DEFS.length);
		const card = branches.find((b) => b.properties.type.const === "Card");
		expect(card?.description).toBe("A titled container.");
		expect(card?.properties.children?.items.$ref).toBe("#/$defs/UINode");
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
