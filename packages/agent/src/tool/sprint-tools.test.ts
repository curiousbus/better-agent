import { expect, it } from "vitest";
import type { SprintStore } from "../ports";
import type { Sprint, SprintStatus } from "../task/types";
import { buildSprintToolDefs } from "./sprint-tools";

const USER = "user-1";
const STAMP = "2026-06-30T00:00:00.000Z";

function makeSprint(
	seq: number,
	u: string,
	input: Parameters<SprintStore["create"]>[1]
): Sprint {
	return {
		id: `s${seq}`,
		userId: u,
		name: input.name,
		goal: input.goal ?? "",
		startDate: input.startDate ?? null,
		endDate: input.endDate ?? null,
		status: "future",
		createdAt: STAMP,
		updatedAt: STAMP,
	};
}

function fakeStore(): SprintStore {
	const rows: Sprint[] = [];
	let seq = 0;
	return {
		list: (u) => Promise.resolve(rows.filter((r) => r.userId === u)),
		create: (u, input) => {
			seq += 1;
			const sprint = makeSprint(seq, u, input);
			rows.push(sprint);
			return Promise.resolve(sprint);
		},
		get: (u, id) =>
			Promise.resolve(rows.find((r) => r.userId === u && r.id === id) ?? null),
		update: (u, id, patch) => {
			const sprint = rows.find((r) => r.userId === u && r.id === id);
			if (!sprint) {
				return Promise.resolve(null);
			}
			Object.assign(sprint, patch);
			return Promise.resolve(sprint);
		},
		active: (u) =>
			Promise.resolve(
				rows.find((r) => r.userId === u && r.status === "active") ?? null
			),
		setStatus: (u, id, status: SprintStatus) => {
			const sprint = rows.find((r) => r.userId === u && r.id === id);
			if (!sprint) {
				return Promise.resolve(null);
			}
			sprint.status = status;
			return Promise.resolve(sprint);
		},
		remove: (u, id) => {
			const i = rows.findIndex((r) => r.userId === u && r.id === id);
			if (i === -1) {
				return Promise.resolve(false);
			}
			rows.splice(i, 1);
			return Promise.resolve(true);
		},
	};
}

const byName = (defs: ReturnType<typeof buildSprintToolDefs>, name: string) => {
	const def = defs.find((d) => d.name === name);
	if (!def) {
		throw new Error(`no tool ${name}`);
	}
	return def;
};

function ctx() {
	return {
		abortSignal: new AbortController().signal,
		agentId: "a1",
		callId: "c1",
		messageId: "m1",
		sessionId: "s1",
	};
}

it("createSprint + listSprints round-trip", async () => {
	const store = fakeStore();
	const defs = buildSprintToolDefs(store, USER);
	const created = await byName(defs, "createSprint").execute(
		{ name: "Sprint 1", goal: "Ship it" },
		ctx()
	);
	const sprint = JSON.parse(created.output);
	expect(sprint.name).toBe("Sprint 1");
	expect(sprint.goal).toBe("Ship it");
	expect(sprint.status).toBe("future");

	const list = await byName(defs, "listSprints").execute({}, ctx());
	expect(JSON.parse(list.output)).toHaveLength(1);
});

it("startSprint sets sprint to active", async () => {
	const store = fakeStore();
	const defs = buildSprintToolDefs(store, USER);
	const created = await byName(defs, "createSprint").execute(
		{ name: "Sprint A" },
		ctx()
	);
	const id = JSON.parse(created.output).id;

	const res = await byName(defs, "startSprint").execute({ id }, ctx());
	const sprint = JSON.parse(res.output);
	expect(res.isError).toBeUndefined();
	expect(sprint.status).toBe("active");
});

it("startSprint rejects with already_active when a different sprint is active", async () => {
	const store = fakeStore();
	const defs = buildSprintToolDefs(store, USER);

	const a = JSON.parse(
		(await byName(defs, "createSprint").execute({ name: "Sprint A" }, ctx()))
			.output
	);
	const b = JSON.parse(
		(await byName(defs, "createSprint").execute({ name: "Sprint B" }, ctx()))
			.output
	);

	// Start sprint A
	await byName(defs, "startSprint").execute({ id: a.id }, ctx());

	// Try to start sprint B — should fail
	const res = await byName(defs, "startSprint").execute({ id: b.id }, ctx());
	expect(res.isError).toBe(true);
	expect(JSON.parse(res.output).error).toBe("already_active");
});

it("completeSprint marks sprint as completed", async () => {
	const store = fakeStore();
	const defs = buildSprintToolDefs(store, USER);

	const created = JSON.parse(
		(await byName(defs, "createSprint").execute({ name: "Sprint Done" }, ctx()))
			.output
	);

	const res = await byName(defs, "completeSprint").execute(
		{ id: created.id },
		ctx()
	);
	const sprint = JSON.parse(res.output);
	expect(res.isError).toBeUndefined();
	expect(sprint.status).toBe("completed");
});
