import { expect, it } from "vitest";
import type { TaskStore } from "../ports";
import type { Task } from "../task/types";
import { buildTaskToolDefs } from "./task-tools";

const USER = "user-1";
const STAMP = "2026-06-30T00:00:00.000Z";

function makeCreate(rows: Task[], counter: { n: number }) {
	return (u: string, input: { title: string; status?: Task["status"] }) => {
		counter.n += 1;
		const task: Task = {
			id: `t${counter.n}`,
			userId: u,
			title: input.title,
			description: "",
			status: input.status ?? "todo",
			position: counter.n,
			createdAt: STAMP,
			updatedAt: STAMP,
		};
		rows.push(task);
		return Promise.resolve(task);
	};
}

function makeMove(rows: Task[]) {
	return (u: string, id: string, status: Task["status"], position: number) => {
		const task = rows.find((r) => r.userId === u && r.id === id);
		if (!task) {
			return Promise.resolve(null);
		}
		task.status = status;
		task.position = position;
		return Promise.resolve(task);
	};
}

function fakeStore(): TaskStore {
	const rows: Task[] = [];
	const counter = { n: 0 };
	return {
		list: (u) => Promise.resolve(rows.filter((r) => r.userId === u)),
		listColumn: (u, status) =>
			Promise.resolve(
				rows.filter((r) => r.userId === u && r.status === status)
			),
		get: (u, id) =>
			Promise.resolve(rows.find((r) => r.userId === u && r.id === id) ?? null),
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

it("createTask then listColumn returns the task as JSON", async () => {
	const defs = buildTaskToolDefs(fakeStore(), USER);
	const created = await byName(defs, "createTask").execute(
		{ title: "hello" },
		ctx()
	);
	expect(JSON.parse(created.output).title).toBe("hello");
	const list = await byName(defs, "listColumn").execute(
		{ status: "todo" },
		ctx()
	);
	expect(JSON.parse(list.output)).toHaveLength(1);
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

function ctx() {
	return {
		abortSignal: new AbortController().signal,
		agentId: "a1",
		callId: "c1",
		messageId: "m1",
		sessionId: "s1",
	};
}
