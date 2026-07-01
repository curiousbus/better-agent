import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import type { AgentClient } from "@curiousbus/agent-client";
import { Loader2, SendHorizontal } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { toast } from "sonner";

interface BoardCommandBarProps {
	agentClient: AgentClient;
	onDone: () => void;
	sessionId: string;
}

// Give the agent board awareness every turn: it has no idea it's driving a
// Kanban board otherwise, and the user refers to tasks as "TASK-<n>" (the seq),
// which the tools accept directly.
const BOARD_PREAMBLE = `You are operating the user's Kanban task board through your tools. Tasks are shown to the user as "TASK-<n>" where <n> is the task's seq number. Reference a task by seq directly — e.g. updateTask({ seq: 3, description: "…" }), moveTask({ seq: 3, status, position }), getTask({ seq: 3 }), deleteTask({ seq: 3 }). Statuses are todo | in_progress | done. Sprint tools: activeSprint, listSprints, createSprint, startSprint, completeSprint. NEVER ask the user what a TASK-<n> reference means — act on it. Carry out the request below, then stop.

Request: `;

// One-way command input: the user tells the agent what to do; the agent runs
// its task/sprint tools and the BOARD is the response (no chat transcript, no
// generative-UI toggle). On completion we refresh the board.
async function runCommand(
	agentClient: AgentClient,
	sessionId: string,
	text: string
): Promise<void> {
	for await (const event of agentClient.stream(BOARD_PREAMBLE + text, {
		sessionId,
	})) {
		if (event.type === "error") {
			throw new Error(event.message);
		}
	}
}

export function BoardCommandBar({
	agentClient,
	sessionId,
	onDone,
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
		runCommand(agentClient, sessionId, text)
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
		<div className="fixed right-6 bottom-6 z-50 w-[26rem] max-w-[calc(100vw-3rem)]">
			<div className="flex items-center gap-1 rounded-full border bg-background/95 p-1.5 pl-4 shadow-lg backdrop-blur">
				<Input
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
		</div>
	);
}
