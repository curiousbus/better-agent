// @vitest-environment jsdom
import { fireEvent, render, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { SkillsCommandsPopover } from "./skills-commands-popover";

it("renders nothing when the agent reported no skills or commands", () => {
	const { container } = render(
		<SkillsCommandsPopover disabled={false} skills={[]} slashCommands={[]} />
	);
	expect(container.querySelector("button")).toBeNull();
});

it("lists the reported skill and command names on open", () => {
	const { container } = render(
		<SkillsCommandsPopover
			disabled={false}
			skills={["brave-search"]}
			slashCommands={["compact", "review"]}
		/>
	);
	const view = within(container);
	fireEvent.click(view.getByRole("button", { name: "Skills and commands" }));
	// Names come from a popover portal rendered on the document body.
	const doc = within(document.body);
	expect(doc.getByText("compact")).toBeDefined();
	expect(doc.getByText("review")).toBeDefined();
	expect(doc.getByText("brave-search")).toBeDefined();
	expect(doc.getByText("Slash commands (2)")).toBeDefined();
	expect(doc.getByText("Skills (1)")).toBeDefined();
});
