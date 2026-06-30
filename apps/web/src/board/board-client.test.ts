import { expect, it, vi } from "vitest";
import { loadColumns, parseColumn, parseTask } from "./board-client";

it("parseColumn maps rows to BoardTask and ignores non-arrays", () => {
	expect(
		parseColumn([{ id: 1, title: "a", status: "todo", position: 2 }])
	).toEqual([
		{ id: "1", title: "a", description: "", status: "todo", position: 2 },
	]);
	expect(parseColumn({ nope: true })).toEqual([]);
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
