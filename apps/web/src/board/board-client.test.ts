import { expect, it, vi } from "vitest";
import {
	loadBacklog,
	loadColumns,
	loadSprintColumns,
	parseColumn,
	parseTask,
} from "./board-client";

it("parseColumn maps rows to BoardTask and ignores non-arrays", () => {
	expect(
		parseColumn([{ id: 1, title: "a", status: "todo", position: 2 }])
	).toEqual([
		{
			id: "1",
			title: "a",
			description: "",
			status: "todo",
			position: 2,
			seq: 0,
			sprintId: null,
		},
	]);
	expect(parseColumn({ nope: true })).toEqual([]);
});

it("parseColumn maps seq and sprintId from row", () => {
	const result = parseColumn([
		{
			id: "x",
			title: "t",
			status: "in_progress",
			position: 3,
			seq: 7,
			sprintId: "sprint-abc",
		},
	]);
	expect(result[0].seq).toBe(7);
	expect(result[0].sprintId).toBe("sprint-abc");
});

it("parseColumn defaults seq to 0 and sprintId to null when absent", () => {
	const result = parseColumn([
		{ id: "y", title: "u", status: "done", position: 1 },
	]);
	expect(result[0].seq).toBe(0);
	expect(result[0].sprintId).toBeNull();
});

it("parseTask maps a single row", () => {
	expect(
		parseTask({ id: "z", title: "t", status: "done", position: 1 })
	).toMatchObject({
		id: "z",
		status: "done",
	});
});

it("loadColumns fires three listColumn calls and routes results by callId", async () => {
	const runTools = vi.fn((_s, _calls, onResult) => {
		onResult({
			callId: "done",
			name: "listColumn",
			result: [{ id: "d", title: "x", status: "done", position: 1 }],
			isError: false,
		});
		return Promise.resolve();
	});
	const seen: string[] = [];
	await loadColumns({ runTools } as never, "s1", (status) => seen.push(status));
	expect(runTools).toHaveBeenCalledTimes(1);
	expect(seen).toContain("done");
});

it("loadSprintColumns fires three listSprintColumn calls carrying sprintId", async () => {
	const calls: { name: string; args: Record<string, unknown> }[] = [];
	const runTools = vi.fn((_s, toolCalls, onResult) => {
		for (const call of toolCalls) {
			calls.push({ name: call.name, args: call.args });
			onResult({
				callId: call.callId,
				name: call.name,
				result: [],
				isError: false,
			});
		}
		return Promise.resolve();
	});
	const seen: string[] = [];
	await loadSprintColumns({ runTools } as never, "s1", "sprint-42", (status) =>
		seen.push(status)
	);
	expect(runTools).toHaveBeenCalledTimes(1);
	expect(calls).toHaveLength(3);
	for (const call of calls) {
		expect(call.name).toBe("listSprintColumn");
		expect(call.args.sprintId).toBe("sprint-42");
	}
	expect(seen).toContain("todo");
	expect(seen).toContain("in_progress");
	expect(seen).toContain("done");
});

it("loadBacklog fires one listBacklog call and routes the result", async () => {
	const runTool = vi.fn(() =>
		Promise.resolve([
			{ id: "b1", title: "backlog item", status: "todo", position: 1 },
		])
	);
	const received: unknown[] = [];
	await loadBacklog({ runTool } as never, "s1", (tasks) =>
		received.push(...tasks)
	);
	expect(runTool).toHaveBeenCalledTimes(1);
	expect(runTool).toHaveBeenCalledWith("s1", "listBacklog", {});
	expect(received).toHaveLength(1);
});
