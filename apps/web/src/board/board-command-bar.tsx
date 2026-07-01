import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import type { AgentClient } from "@curiousbus/agent-client";
import { Loader2, SendHorizontal, Sparkles, X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { toast } from "sonner";
import type { BoardTask } from "./board-store";

interface BoardCommandBarProps {
	activeSprintName: string | null;
	agentClient: AgentClient;
	onDone: () => void;
	sessionId: string;
	tasks: BoardTask[];
}

const PREAMBLE = `You are operating the user's Kanban task board through your tools. Tasks are shown as "TASK-<n>" where <n> is the task's seq (given in the board below — never ask what a TASK-<n> is).

Rules:
- Mark a task done / finished / complete → moveTask({ seq, status: "done" }). This is a STATUS change only: the task stays on the board in the Done column. "Done/complete/finish" NEVER means delete, and NEVER changes its sprint.
- Move a task between columns → moveTask({ seq, status: "todo" | "in_progress" | "done" }).
- Edit a task → updateTask({ seq, title?, description? }).
- NEVER pass sprintId to moveTask unless the user explicitly says move it to the backlog (sprintId: null) or to another sprint.
- deleteTask only when the user explicitly says delete/remove a task.
- completeSprint only when the user explicitly says finish/close the whole sprint — never for one task.
Do the request, then stop.`;

// Feed the already-rendered board state (the session's own data) as context so
// the agent knows exactly what TASK-<n> is without re-fetching or guessing.
function boardContext(tasks: BoardTask[], activeSprintName: string | null) {
	const header = activeSprintName
		? `Active sprint: "${activeSprintName}".`
		: "No active sprint.";
	if (tasks.length === 0) {
		return `${header} The board has no tasks yet.`;
	}
	const lines = tasks
		.map((t) => {
			const where = t.sprintId === null ? "backlog" : t.status;
			return `- TASK-${t.seq}: "${t.title}" [${where}]`;
		})
		.join("\n");
	return `${header}\nCurrent tasks:\n${lines}`;
}

async function runCommand(
	agentClient: AgentClient,
	sessionId: string,
	prompt: string
): Promise<void> {
	for await (const event of agentClient.stream(prompt, { sessionId })) {
		if (event.type === "error") {
			throw new Error(event.message);
		}
	}
}

function CommandInput({
	agentClient,
	sessionId,
	onDone,
	tasks,
	activeSprintName,
}: BoardCommandBarProps) {
	const [value, setValue] = useState("");
	const [busy, setBusy] = useState(false);

	const submit = () => {
		const text = value.trim();
		if (text === "" || busy) {
			return;
		}
		setBusy(true);
		setValue("");
		const prompt = `${PREAMBLE}\n\n${boardContext(tasks, activeSprintName)}\n\nRequest: ${text}`;
		runCommand(agentClient, sessionId, prompt)
			.then(onDone)
			.catch(() => toast.error("The agent couldn't complete that."))
			.finally(() => setBusy(false));
	};

	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			submit();
		}
	};

	return (
		<div className="slide-in-from-right-2 flex w-[24rem] max-w-[calc(100vw-6rem)] animate-in items-center gap-1 rounded-full border bg-background/95 p-1.5 pl-4 shadow-lg backdrop-blur">
			<Input
				// biome-ignore lint/a11y/noAutofocus: intentional — the bar opens on user click
				autoFocus
				className="border-0 bg-transparent shadow-none focus-visible:ring-0"
				disabled={busy}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={onKeyDown}
				placeholder="Tell the agent what to do…"
				value={value}
			/>
			<Button
				aria-label="Send command"
				className="rounded-full"
				disabled={busy || value.trim() === ""}
				onClick={submit}
				size="icon"
			>
				{busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
			</Button>
		</div>
	);
}

export function BoardCommandBar(props: BoardCommandBarProps) {
	const [open, setOpen] = useState(false);
	return (
		<div className="fixed right-6 bottom-6 z-50 flex items-center gap-2">
			{open ? <CommandInput {...props} /> : null}
			<Button
				aria-label={open ? "Close command bar" : "Open command bar"}
				className="size-12 shrink-0 rounded-full shadow-lg"
				onClick={() => setOpen((v) => !v)}
				size="icon"
			>
				{open ? <X /> : <Sparkles />}
			</Button>
		</div>
	);
}
