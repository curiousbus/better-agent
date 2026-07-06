// @vitest-environment jsdom
import { expect, it } from "vitest";
import type { StreamEvent } from "./bridge-events";
import { foldEventsToTurns } from "./bridge-turns";

const ev = (id: number, event: StreamEvent["event"]): StreamEvent => ({
	id,
	event,
});

it("folds an opencode plan update into a single todolist turn", () => {
	const turns = foldEventsToTurns([
		ev(1, { kind: "message", role: "user", text: "do it" }),
		ev(2, {
			kind: "status",
			status: "plan",
			detail: [
				{ content: "Read the code", status: "completed" },
				{ content: "Write the fix", status: "in_progress" },
				{ content: "Run tests", status: "pending" },
			],
		}),
	]);
	const plan = turns.find((turn) => turn.kind === "plan");
	if (plan?.kind !== "plan") {
		throw new Error("expected a plan turn");
	}
	expect(plan.items).toEqual([
		{ content: "Read the code", status: "completed" },
		{ content: "Write the fix", status: "in_progress" },
		{ content: "Run tests", status: "pending" },
	]);
});

it("updates the plan in place across successive plan updates (one turn, latest items)", () => {
	const turns = foldEventsToTurns([
		ev(1, {
			kind: "status",
			status: "plan",
			detail: [{ content: "A", status: "pending" }],
		}),
		ev(2, {
			kind: "status",
			status: "plan",
			detail: [
				{ content: "A", status: "completed" },
				{ content: "B", status: "in_progress" },
			],
		}),
	]);
	const plans = turns.filter((turn) => turn.kind === "plan");
	expect(plans).toHaveLength(1);
	if (plans[0]?.kind !== "plan") {
		throw new Error("expected a plan turn");
	}
	expect(plans[0].items).toEqual([
		{ content: "A", status: "completed" },
		{ content: "B", status: "in_progress" },
	]);
});
