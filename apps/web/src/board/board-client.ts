import type { AgentClient } from "@curiousbus/agent-client";
import type { BoardStatus, BoardTask } from "./board-store";

export function parseColumn(result: unknown): BoardTask[] {
	if (!Array.isArray(result)) {
		return [];
	}
	return result.map((row) => ({
		id: String((row as BoardTask).id),
		title: String((row as BoardTask).title),
		description: String((row as BoardTask).description ?? ""),
		status: (row as BoardTask).status,
		position: Number((row as BoardTask).position ?? 0),
	}));
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
