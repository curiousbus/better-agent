import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@better-agent/ui/components/card";
import type { NodeProps } from "@better-agent/ui/components/genui/generative-ui";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import type { ComponentType } from "react";
import { TodoList } from "./todo-list";

const str = (v: unknown, fallback = ""): string =>
	typeof v === "string" ? v : fallback;

function TodoListNode(_: NodeProps) {
	return <TodoList />;
}

function Stack({ node, renderChildren }: NodeProps) {
	const horizontal = node.props.direction === "horizontal";
	return (
		<div className={horizontal ? "flex gap-3" : "flex flex-col gap-3"}>
			{renderChildren(node.children)}
		</div>
	);
}

function CardNode({ node, renderChildren }: NodeProps) {
	return (
		<Card className="w-full max-w-md gap-3 py-4">
			{node.props.title ? (
				<CardHeader className="px-4">
					<CardTitle className="text-sm">{str(node.props.title)}</CardTitle>
				</CardHeader>
			) : null}
			<CardContent className="flex flex-col gap-2 px-4">
				{renderChildren(node.children)}
			</CardContent>
		</Card>
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
		<div className="flex flex-col gap-1.5">
			<Label>{str(node.props.label)}</Label>
			<Input
				name={str(node.props.name)}
				placeholder={str(node.props.placeholder)}
			/>
		</div>
	);
}

export const RENDERERS: Record<string, ComponentType<NodeProps>> = {
	TodoList: TodoListNode,
	Stack,
	Card: CardNode,
	Heading,
	Text,
	Badge: BadgeNode,
	Stat,
	List: ListNode,
	Button: ButtonNode,
	Form: FormNode,
	TextField,
};
