export interface PartialNode {
	action?: unknown;
	children?: unknown[];
	id?: string;
	props?: Record<string, unknown>;
	type?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Unwrap the `{ root }` envelope from structured output (partial or final). */
export function readRoot(tree: unknown): unknown {
	if (isRecord(tree) && "root" in tree) {
		return tree.root;
	}
	return tree;
}

/** Coerce an unknown (possibly half-streamed) value into a partial node. */
export function asNode(value: unknown): PartialNode | null {
	if (!isRecord(value)) {
		return null;
	}
	return value as PartialNode;
}

/** A node is renderable (not a skeleton) once it has a stable id and type. */
export function nodeComplete(value: unknown): boolean {
	const node = asNode(value);
	return typeof node?.id === "string" && typeof node?.type === "string";
}
