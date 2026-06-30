import type { AgentClient } from "@curiousbus/agent-client";
import type { BoardStatus, BoardTask } from "./board-store";

export function parseColumn(result: unknown): BoardTask[] {
	if (!Array.isArray(result)) {
		return [];
	}
	return result.map((row) => {
		const r = row as BoardTask;
		return {
			id: String(r.id),
			title: String(r.title),
			description: String(r.description ?? ""),
			status: r.status,
			position: Number(r.position ?? 0),
			seq: Number(r.seq ?? 0),
			sprintId: (r.sprintId ?? null) as string | null,
			createdAt: r.createdAt,
		};
	});
}

export function parseTask(result: unknown): BoardTask {
	const [task] = parseColumn([result]);
	return task;
}

export async function loadColumns(
	client: AgentClient,
	sessionId: string,
	onColumn: (status: BoardStatus, tasks: BoardTask[]) => void
): Promise<void> {
	const calls = (["todo", "in_progress", "done"] as BoardStatus[]).map(
		(status) => ({
			callId: status,
			name: "listColumn",
			args: { status },
		})
	);
	await client.runTools(sessionId, calls, (result) => {
		onColumn(result.callId as BoardStatus, parseColumn(result.result));
	});
}

export async function loadSprintColumns(
	client: AgentClient,
	sessionId: string,
	sprintId: string,
	onColumn: (status: BoardStatus, tasks: BoardTask[]) => void
): Promise<void> {
	const calls = (["todo", "in_progress", "done"] as BoardStatus[]).map(
		(status) => ({
			callId: status,
			name: "listSprintColumn",
			args: { sprintId, status },
		})
	);
	await client.runTools(sessionId, calls, (result) => {
		onColumn(result.callId as BoardStatus, parseColumn(result.result));
	});
}

export async function loadBacklog(
	client: AgentClient,
	sessionId: string,
	onBacklog: (tasks: BoardTask[]) => void
): Promise<void> {
	const result = await client.runTool(sessionId, "listBacklog", {});
	onBacklog(parseColumn(result));
}
