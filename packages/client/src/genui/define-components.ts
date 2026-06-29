import type { ComponentDef, GenerativeUI, UINode } from "./types";

export type { ComponentDef, GenerativeUI, UIAction, UINode } from "./types";

// How deep the agent may nest container components. The node union is INLINED
// to this depth rather than expressed with a recursive `$ref`/`$defs`, because
// several model providers (notably Anthropic) reject `$ref` in tool input
// schemas — a recursive schema makes the whole turn fail. Inlining keeps the
// schema self-contained and provider-portable; the depth bounds its size.
// Depth 2 (e.g. Card › Stack › leaves) suffices for the demo and keeps the
// inlined schema small; raising it multiplies size by the container count.
const MAX_DEPTH = 2;

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

function branchSchema(
	def: ComponentDef,
	defs: ComponentDef[],
	depth: number
): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		id: { type: "string" },
		type: { const: def.type },
		props: def.props,
	};
	if (def.children && depth > 0) {
		properties.children = { type: "array", items: nodeSchema(defs, depth - 1) };
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

// A UINode at a given remaining depth: the union of every component branch.
function nodeSchema(
	defs: ComponentDef[],
	depth: number
): Record<string, unknown> {
	return { anyOf: defs.map((def) => branchSchema(def, defs, depth)) };
}

function buildSchema(defs: ComponentDef[]): Record<string, unknown> {
	return {
		type: "object",
		properties: { root: nodeSchema(defs, MAX_DEPTH) },
		required: ["root"],
		additionalProperties: false,
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
