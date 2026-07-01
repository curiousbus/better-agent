import { expect, it } from "vitest";
import type { TaskStore } from "../ports";
import type { Task } from "../task/types";
import { buildTaskToolDefs } from "./task-tools";

const USER = "user-1";
const STAMP = "2026-06-30T00:00:00.000Z";

function makeCreate(rows: Task[], counter: { n: number }) {
	return (
		u: string,
		input: { title: string; status?: Task["status"]; sprintId?: string | null }
	) => {
		counter.n += 1;
		const task: Task = {
			id: `t${counter.n}`,
			seq: counter.n,
			userId: u,
			title: input.title,
			description: "",
			status: input.status ?? "todo",
			sprintId: input.sprintId ?? null,
			position: counter.n,
			createdAt: STAMP,
			updatedAt: STAMP,
		};
		rows.push(task);
		return Promise.resolve(task);
	};
}

function makeMove(rows: Task[]) {
	return (
		u: string,
		id: string,
		patch: {
			position: number;
			sprintId?: string | null;
			status: Task["status"];
		}
	) => {
		const task = rows.find((r) => r.userId === u && r.id === id);
		if (!task) {
			return Promise.resolve(null);
		}
		task.status = patch.status;
		task.position = patch.position;
		if ("sprintId" in patch) {
			task.sprintId = patch.sprintId ?? null;
		}
		return Promise.resolve(task);
	};
}

function fakeStore(): TaskStore {
	const rows: Task[] = [];
	const counter = { n: 0 };
	return {
		listBacklog: (u) =>
			Promise.resolve(
				rows.filter((r) => r.userId === u && r.sprintId === null)
			),
		listColumn: (u, sprintId, status) =>
			Promise.resolve(
				rows.filter(
					(r) =>
						r.userId === u && r.sprintId === sprintId && r.status === status
				)
			),
		get: (u, id) =>
			Promise.resolve(rows.find((r) => r.userId === u && r.id === id) ?? null),
		getBySeq: (u, seq) =>
			Promise.resolve(
				rows.find((r) => r.userId === u && r.seq === seq) ?? null
			),
		create: makeCreate(rows, counter),
		update: (u, id, patch) => {
			const task = rows.find((r) => r.userId === u && r.id === id);
			if (!task) {
				return Promise.resolve(null);
			}
			Object.assign(task, patch);
			return Promise.resolve(task);
		},
		move: makeMove(rows),
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

const byName = (defs: ReturnType<typeof buildTaskToolDefs>, name: string) => {
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

it("createTask round-trip: creates and is retrievable", async () => {
	const defs = buildTaskToolDefs(fakeStore(), USER);
	const created = await byName(defs, "createTask").execute(
		{ title: "hello" },
		ctx()
	);
	const parsed = JSON.parse(created.output);
	expect(parsed.title).toBe("hello");
	expect(parsed.seq).toBe(1);
	expect(parsed.sprintId).toBeNull();
});

it("listBacklog returns tasks not assigned to a sprint", async () => {
	const store = fakeStore();
	const defs = buildTaskToolDefs(store, USER);
	await byName(defs, "createTask").execute({ title: "backlog task" }, ctx());
	const list = await byName(defs, "listBacklog").execute({}, ctx());
	expect(JSON.parse(list.output)).toHaveLength(1);
});

it("updateTask/getTask resolve a task by seq (TASK-<seq>)", async () => {
	const defs = buildTaskToolDefs(fakeStore(), USER);
	const created = JSON.parse(
		(await byName(defs, "createTask").execute({ title: "t1" }, ctx())).output
	);
	const res = await byName(defs, "updateTask").execute(
		{ seq: created.seq, description: "done via seq" },
		ctx()
	);
	expect(JSON.parse(res.output).description).toBe("done via seq");
	const got = await byName(defs, "getTask").execute(
		{ seq: created.seq },
		ctx()
	);
	expect(JSON.parse(got.output).id).toBe(created.id);
});

it("listSprintColumn filters by sprintId and status", async () => {
	const store = fakeStore();
	const defs = buildTaskToolDefs(store, USER);
	// Create a task assigned to sprint-1
	await store.create(USER, {
		title: "sprint task",
		sprintId: "sprint-1",
		status: "todo",
	});
	// Create a backlog task
	await store.create(USER, { title: "backlog task" });
	const list = await byName(defs, "listSprintColumn").execute(
		{ sprintId: "sprint-1", status: "todo" },
		ctx()
	);
	const results = JSON.parse(list.output);
	expect(results).toHaveLength(1);
	expect(results[0].title).toBe("sprint task");
});

it("moveTask on a missing id returns isError not_found", async () => {
	const defs = buildTaskToolDefs(fakeStore(), USER);
	const res = await byName(defs, "moveTask").execute(
		{ id: "nope", status: "done", position: 1 },
		ctx()
	);
	expect(res.isError).toBe(true);
	expect(JSON.parse(res.output).error).toBe("not_found");
});
