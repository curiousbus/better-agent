// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { parseTodoItems, TodoList } from "./todo-list";

it("parses tolerant field names and status variants", () => {
	expect(
		parseTodoItems([
			{ content: "a", status: "completed" },
			{ text: "b", status: "in-progress" },
			{ title: "c", status: "todo" },
			{ nope: 1 },
		])
	).toEqual([
		{ content: "a", status: "completed" },
		{ content: "b", status: "in_progress" },
		{ content: "c", status: "pending" },
	]);
});

it("renders the checklist with a done/total count", () => {
	const { container } = render(
		<TodoList
			items={[
				{ content: "Read the code", status: "completed" },
				{ content: "Write the fix", status: "in_progress" },
			]}
		/>
	);
	const view = within(container);
	expect(view.getByText("Read the code")).toBeDefined();
	expect(view.getByText("Write the fix")).toBeDefined();
	expect(view.getByText("1/2")).toBeDefined();
});

it("renders nothing for an empty list", () => {
	const { container } = render(<TodoList items={[]} />);
	expect(container.firstChild).toBeNull();
});
