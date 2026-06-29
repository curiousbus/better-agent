import type { ComponentDef, GenerativeUI, UINode } from "./types";

export type { ComponentDef, GenerativeUI, UIAction, UINode } from "./types";

const NODE_REF = "#/$defs/UINode";

function actionSchema(actions: string[]): Record<string, unknown> {
	return {
		type: "object",
		properties: {
			intent: { type: "string", enum: actions },
			target: { type: "string", enum: ["agent", "client"] },
			payload: {},
		},
		required: ["intent", "target"],
		additionalProperties: false,
	};
}

function branchSchema(def: ComponentDef): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		id: { type: "string" },
		type: { const: def.type },
		props: def.props,
	};
	if (def.children) {
		properties.children = { type: "array", items: { $ref: NODE_REF } };
	}
	if (def.actions && def.actions.length > 0) {
		properties.action = actionSchema(def.actions);
	}
	return {
		type: "object",
		description: def.description,
		properties,
		required: ["id", "type", "props"],
		additionalProperties: false,
	};
}

function buildSchema(defs: ComponentDef[]): Record<string, unknown> {
	return {
		type: "object",
		properties: { root: { $ref: NODE_REF } },
		required: ["root"],
		additionalProperties: false,
		$defs: { UINode: { anyOf: defs.map(branchSchema) } },
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNode(value: unknown, types: Set<string>): UINode | null {
	if (!isRecord(value)) {
		return null;
	}
	const { id, type, props, children } = value;
	if (typeof id !== "string" || typeof type !== "string" || !types.has(type)) {
		return null;
	}
	if (!isRecord(props)) {
		return null;
	}
	if (children !== undefined) {
		if (!Array.isArray(children)) {
			return null;
		}
		for (const child of children) {
			if (validateNode(child, types) === null) {
				return null;
			}
		}
	}
	return value as unknown as UINode;
}

/** Compile a component manifest into a model schema + a structural validator. */
export function defineComponents(defs: ComponentDef[]): GenerativeUI {
	const types = new Set(defs.map((d) => d.type));
	const outputSchema = buildSchema(defs);
	return {
		outputSchema,
		types: [...types],
		validate(structured) {
			if (!isRecord(structured)) {
				return null;
			}
			return validateNode(structured.root, types);
		},
	};
}
