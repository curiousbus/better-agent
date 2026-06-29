import { asNode, nodeComplete } from "@better-agent/ui/lib/genui-tree";
import type { UIAction, UINode } from "@curiousbus/agent-client";
import type { ComponentType, ReactNode } from "react";

export interface NodeProps {
	node: UINode;
	onAction: (action: UIAction) => void;
	renderChildren: (children?: UINode[]) => ReactNode;
}

interface NodeViewProps {
	depth?: number;
	onAction: (action: UIAction) => void;
	renderers: Record<string, ComponentType<NodeProps>>;
	value: unknown;
}

const MAX_TREE_DEPTH = 32;

function Skeleton() {
	return (
		<div className="h-6 w-32 animate-pulse rounded bg-muted motion-reduce:animate-none" />
	);
}

function Unknown({ type }: { type: string }) {
	return (
		<div className="rounded border border-dashed px-2 py-1 text-muted-foreground text-xs">
			Unsupported component: {type}
		</div>
	);
}

export function NodeView({
	value,
	renderers,
	onAction,
	depth = 0,
}: NodeViewProps) {
	if (depth >= MAX_TREE_DEPTH) {
		return null;
	}
	if (!nodeComplete(value)) {
		return <Skeleton />;
	}
	const node = asNode(value) as UINode;
	const Renderer = renderers[node.type];
	if (!Renderer) {
		return <Unknown type={node.type} />;
	}
	const renderChildren = (children?: UINode[]): ReactNode =>
		(children ?? []).map((child) => (
			<NodeView
				depth={depth + 1}
				key={child.id}
				onAction={onAction}
				renderers={renderers}
				value={child}
			/>
		));
	return (
		<Renderer node={node} onAction={onAction} renderChildren={renderChildren} />
	);
}
