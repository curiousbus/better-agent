// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { stripTaskWrapper, TaskCard } from "./task-card";

it("strips the <task>/<task_result> XML wrapper down to the inner summary", () => {
	const wrapped =
		'<task id="ses_1" state="completed">\n<task_result>\nfound 3 files\n</task_result>\n</task>';
	expect(stripTaskWrapper(wrapped)).toBe("found 3 files");
});

it("leaves a plain, unwrapped result untouched (Claude's Task tool)", () => {
	expect(stripTaskWrapper("plain summary text")).toBe("plain summary text");
});

it("renders the description as the title and the result text in the collapsible body", () => {
	const { container } = render(
		<TaskCard
			task={{
				callId: "t1",
				resultText: "explored the project",
				status: "complete",
				title: "Explore project structure",
			}}
		/>
	);
	const scope = within(container);
	expect(scope.getByText("Explore project structure")).toBeDefined();
	fireEvent.click(scope.getByRole("button"));
	expect(scope.getByText("explored the project")).toBeDefined();
});

it("shows the running status before a result has arrived", () => {
	const { container } = render(
		<TaskCard
			task={{
				callId: "t1",
				resultText: "",
				status: "running",
				title: "Explore project structure",
			}}
		/>
	);
	expect(within(container).getByText("Running…")).toBeDefined();
});

it("shows the failed status for an errored task", () => {
	const { container } = render(
		<TaskCard
			task={{
				callId: "t1",
				resultText: "boom",
				status: "error",
				title: "Explore project structure",
			}}
		/>
	);
	expect(within(container).getByText("Failed")).toBeDefined();
});
