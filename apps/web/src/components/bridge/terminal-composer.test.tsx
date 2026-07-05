// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { TerminalComposer } from "./terminal-composer";

const COMMANDS = ["compact", "clear"];
const SKILLS = ["pdf"];

it("opens the picker with the session's commands and skills on a bare '/'", () => {
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={vi.fn()}
			sending={false}
			skills={SKILLS}
			slashCommands={COMMANDS}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "/" } });

	expect(view.getByRole("listbox")).toBeDefined();
	expect(view.getByText("Commands")).toBeDefined();
	expect(view.getByText("Skills")).toBeDefined();
	expect(view.getByRole("option", { name: "compact" })).toBeDefined();
	expect(view.getByRole("option", { name: "clear" })).toBeDefined();
	expect(view.getByRole("option", { name: "pdf" })).toBeDefined();
});

it("filters to matching commands/skills as the query narrows", () => {
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={vi.fn()}
			sending={false}
			skills={SKILLS}
			slashCommands={COMMANDS}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "/co" } });

	expect(view.getByRole("option", { name: "compact" })).toBeDefined();
	expect(view.queryByRole("option", { name: "clear" })).toBeNull();
	expect(view.queryByRole("option", { name: "pdf" })).toBeNull();
});

it("moves the highlight with arrow keys and Enter fills the box without sending", () => {
	const onSend = vi.fn();
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={onSend}
			sending={false}
			skills={SKILLS}
			slashCommands={COMMANDS}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "/" } });
	fireEvent.keyDown(textarea, { key: "ArrowDown" });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(textarea.value).toBe("/clear ");
	expect(onSend).not.toHaveBeenCalled();
	expect(view.queryByRole("listbox")).toBeNull();
});

it("selecting by click also just fills the box", () => {
	const onSend = vi.fn();
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={onSend}
			sending={false}
			skills={SKILLS}
			slashCommands={COMMANDS}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "/pd" } });
	fireEvent.mouseDown(view.getByRole("option", { name: "pdf" }));

	expect(textarea.value).toBe("/pdf ");
	expect(onSend).not.toHaveBeenCalled();
});

it("Escape clears the in-progress slash entry and closes the picker", () => {
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={vi.fn()}
			sending={false}
			skills={SKILLS}
			slashCommands={COMMANDS}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "/co" } });
	fireEvent.keyDown(textarea, { key: "Escape" });

	expect(textarea.value).toBe("");
	expect(view.queryByRole("listbox")).toBeNull();
});

it("shows no picker when the session hasn't reported any commands/skills", () => {
	const { container } = render(
		<TerminalComposer disabled={false} onSend={vi.fn()} sending={false} />
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "/" } });

	expect(view.queryByRole("listbox")).toBeNull();
});

it("still sends a plain (non-slash) message normally", () => {
	const onSend = vi.fn();
	const { container } = render(
		<TerminalComposer
			disabled={false}
			onSend={onSend}
			sending={false}
			skills={SKILLS}
			slashCommands={COMMANDS}
		/>
	);
	const view = within(container);
	const textarea = view.getByLabelText("Message") as HTMLTextAreaElement;

	fireEvent.change(textarea, { target: { value: "hello agent" } });
	fireEvent.keyDown(textarea, { key: "Enter" });

	expect(onSend).toHaveBeenCalledWith("hello agent");
});
