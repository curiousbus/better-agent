import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import type { NodeProps } from "@better-agent/ui/components/genui/generative-ui";
import type { ComponentType } from "react";

const str = (v: unknown, fallback = ""): string =>
	typeof v === "string" ? v : fallback;

function Stack({ node, renderChildren }: NodeProps) {
	const horizontal = node.props.direction === "horizontal";
	return (
		<div className={horizontal ? "flex gap-3" : "flex flex-col gap-3"}>
			{renderChildren(node.children)}
		</div>
	);
}

function Card({ node, renderChildren }: NodeProps) {
	return (
		<div className="rounded-lg border p-4">
			{node.props.title ? (
				<h3 className="mb-2 font-medium text-sm">{str(node.props.title)}</h3>
			) : null}
			<div className="flex flex-col gap-2">{renderChildren(node.children)}</div>
		</div>
	);
}

function Heading({ node }: NodeProps) {
	return <h2 className="font-semibold text-lg">{str(node.props.text)}</h2>;
}

function Text({ node }: NodeProps) {
	return <p className="text-sm">{str(node.props.text)}</p>;
}

function BadgeNode({ node }: NodeProps) {
	return <Badge>{str(node.props.label)}</Badge>;
}

function Stat({ node }: NodeProps) {
	return (
		<div>
			<div className="text-muted-foreground text-xs">
				{str(node.props.label)}
			</div>
			<div className="font-semibold text-xl">{str(node.props.value)}</div>
		</div>
	);
}

function ListNode({ node }: NodeProps) {
	const items = Array.isArray(node.props.items) ? node.props.items : [];
	return (
		<ul className="list-disc pl-5 text-sm">
			{items.map((it, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static rendered list
				<li key={i}>{str(it)}</li>
			))}
		</ul>
	);
}

function handleButtonClick(
	node: NodeProps["node"],
	onAction: NodeProps["onAction"]
) {
	const action = node.action ?? { intent: "press", target: "agent" as const };
	onAction(action);
}

function ButtonNode({ node, onAction }: NodeProps) {
	return (
		<Button onClick={() => handleButtonClick(node, onAction)} size="sm">
			{str(node.props.label, "Button")}
		</Button>
	);
}

function handleFormSubmit(
	e: React.FormEvent<HTMLFormElement>,
	node: NodeProps["node"],
	onAction: NodeProps["onAction"]
) {
	e.preventDefault();
	const data = Object.fromEntries(new FormData(e.currentTarget));
	const action = node.action ?? {
		intent: "submit",
		target: "agent" as const,
		payload: data,
	};
	onAction(action);
}

function FormNode({ node, onAction, renderChildren }: NodeProps) {
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(e) => handleFormSubmit(e, node, onAction)}
		>
			{renderChildren(node.children)}
			<Button size="sm" type="submit">
				{str(node.props.submitLabel, "Submit")}
			</Button>
		</form>
	);
}

function TextField({ node }: NodeProps) {
	return (
		<label className="flex flex-col gap-1 text-sm">
			<span>{str(node.props.label)}</span>
			<input
				className="rounded border px-2 py-1"
				name={str(node.props.name)}
				placeholder={str(node.props.placeholder)}
			/>
		</label>
	);
}

export const RENDERERS: Record<string, ComponentType<NodeProps>> = {
	Stack,
	Card,
	Heading,
	Text,
	Badge: BadgeNode,
	Stat,
	List: ListNode,
	Button: ButtonNode,
	Form: FormNode,
	TextField,
};
