import { readRoot } from "@better-agent/ui/lib/genui-tree";
import type { UIAction } from "@curiousbus/agent-client";
import type { ComponentType } from "react";
import { type NodeProps, NodeView } from "./node-view";

export type { NodeProps } from "./node-view";

export interface GenerativeUIProps {
	onAction: (action: UIAction) => void;
	renderers: Record<string, ComponentType<NodeProps>>;
	tree: unknown;
}

/** Render an agent-produced UI tree (partial during stream, final after). */
export function GenerativeUI({ tree, renderers, onAction }: GenerativeUIProps) {
	const root = readRoot(tree);
	if (root === null || root === undefined) {
		return null;
	}
	return <NodeView onAction={onAction} renderers={renderers} value={root} />;
}
