/** An action a rendered component may emit back to the host. */
export interface UIAction {
	intent: string;
	payload?: unknown;
	target: "agent" | "client";
}

/** A node in the agent-produced UI tree (structured output). */
export interface UINode {
	action?: UIAction;
	children?: UINode[];
	id: string;
	props: Record<string, unknown>;
	type: string;
}

/** One registered component: the client's "contract language". `props` is a
 * JSON Schema object (author it however you like, e.g. `z.toJSONSchema(...)`). */
export interface ComponentDef {
	actions?: string[];
	children?: boolean;
	description: string;
	props: Record<string, unknown>;
	type: string;
}

/** The compiled library: schema for the model + a structural validator. */
export interface GenerativeUI {
	outputSchema: Record<string, unknown>;
	types: string[];
	validate(structured: unknown): UINode | null;
}
