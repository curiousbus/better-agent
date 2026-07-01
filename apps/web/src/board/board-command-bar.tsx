import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import { cn } from "@better-agent/ui/lib/utils";
import type { AgentClient } from "@curiousbus/agent-client";
import { Loader2, SendHorizontal, Sparkles, X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import type { BoardTask } from "./board-store";

interface BoardCommandBarProps {
	activeSprintName: string | null;
	agentClient: AgentClient;
	onDone: () => void;
	sessionId: string;
	tasks: BoardTask[];
}

interface ChatMessage {
	role: "agent" | "user";
	text: string;
}

const PREAMBLE = `You are operating the user's Kanban task board through your tools. Tasks are shown as "TASK-<n>" where <n> is the task's seq (given in the board below — never ask what a TASK-<n> is).

Rules:
- Mark a task done → moveTask({ seq, status: "done" }). Status change only: it stays on the board, is never deleted, and keeps its sprint.
- Move a task → moveTask({ seq, status }). Edit → updateTask({ seq, title?, description? }).
- deleteTask / completeSprint only when the user explicitly asks. Reply briefly with what you did.`;

function boardContext(tasks: BoardTask[], activeSprintName: string | null) {
	const header = activeSprintName
		? `Active sprint: "${activeSprintName}".`
		: "No active sprint.";
	if (tasks.length === 0) {
		return `${header} The board has no tasks yet.`;
	}
	const lines = tasks
		.map((t) => `- TASK-${t.seq}: "${t.title}" [${t.status}]`)
		.join("\n");
	return `${header}\nCurrent tasks:\n${lines}`;
}

async function runTurn(
	agentClient: AgentClient,
	sessionId: string,
	prompt: string
): Promise<string> {
	let reply = "";
	for await (const event of agentClient.stream(prompt, { sessionId })) {
		if (event.type === "text-delta") {
			reply += event.delta;
		} else if (event.type === "error") {
			throw new Error(event.message);
		}
	}
	return reply.trim();
}

function useBoardChat(props: BoardCommandBarProps) {
	const { agentClient, sessionId, onDone, tasks, activeSprintName } = props;
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [busy, setBusy] = useState(false);

	const send = (text: string) => {
		setMessages((m) => [...m, { role: "user", text }]);
		setBusy(true);
		const prompt = `${PREAMBLE}\n\n${boardContext(tasks, activeSprintName)}\n\nRequest: ${text}`;
		runTurn(agentClient, sessionId, prompt)
			.then((reply) => {
				setMessages((m) => [...m, { role: "agent", text: reply || "Done." }]);
				onDone();
			})
			.catch(() =>
				setMessages((m) => [
					...m,
					{ role: "agent", text: "Sorry, I couldn't do that." },
				])
			)
			.finally(() => setBusy(false));
	};

	return { messages, busy, send };
}

function MessageList({
	messages,
	busy,
}: {
	busy: boolean;
	messages: ChatMessage[];
}) {
	return (
		<div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
			{messages.length === 0 ? (
				<p className="text-muted-foreground">
					Tell the agent what to do — e.g. "move TASK-3 to done".
				</p>
			) : null}
			{messages.map((m, i) => (
				<div
					className={m.role === "user" ? "text-right" : "text-left"}
					// biome-ignore lint/suspicious/noArrayIndexKey: append-only chat log
					key={i}
				>
					<span
						className={cn(
							"inline-block max-w-[85%] rounded-lg px-3 py-1.5 text-left",
							m.role === "user"
								? "bg-primary text-primary-foreground"
								: "whitespace-pre-wrap bg-muted"
						)}
					>
						{m.text}
					</span>
				</div>
			))}
			{busy ? (
				<span className="flex items-center gap-2 text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Working…
				</span>
			) : null}
		</div>
	);
}

function Composer({
	busy,
	onSend,
}: {
	busy: boolean;
	onSend: (v: string) => void;
}) {
	const [value, setValue] = useState("");
	const submit = () => {
		const text = value.trim();
		if (text === "" || busy) {
			return;
		}
		setValue("");
		onSend(text);
	};
	const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			submit();
		}
	};
	return (
		<div className="flex items-center gap-2 border-t p-3">
			<Input
				disabled={busy}
				onChange={(e) => setValue(e.target.value)}
				onKeyDown={onKeyDown}
				placeholder="Tell the agent…"
				value={value}
			/>
			<Button
				aria-label="Send"
				disabled={busy || value.trim() === ""}
				onClick={submit}
				size="icon"
			>
				{busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
			</Button>
		</div>
	);
}

function Drawer({
	open,
	onClose,
	chat,
}: {
	chat: ReturnType<typeof useBoardChat>;
	onClose: () => void;
	open: boolean;
}) {
	return (
		<aside
			className={cn(
				// Frosted-glass panel: translucent + blur so the board shows through
				// behind it. No backdrop/mask.
				"fixed top-0 right-0 z-50 flex h-full w-[26rem] max-w-[90vw] flex-col border-l bg-background/70 shadow-xl backdrop-blur-md transition-transform duration-300 ease-out",
				open ? "translate-x-0" : "translate-x-full"
			)}
		>
			<header className="flex items-center justify-between border-b p-3">
				<span className="font-medium text-sm">Assistant</span>
				<Button
					aria-label="Close"
					onClick={onClose}
					size="icon"
					variant="ghost"
				>
					<X />
				</Button>
			</header>
			<MessageList busy={chat.busy} messages={chat.messages} />
			<Composer busy={chat.busy} onSend={chat.send} />
		</aside>
	);
}

export function BoardCommandBar(props: BoardCommandBarProps) {
	const [open, setOpen] = useState(false);
	const chat = useBoardChat(props);
	const close = () => setOpen(false);
	return (
		<>
			{open ? null : (
				<Button
					aria-label="Open assistant"
					className="fixed right-6 bottom-6 z-40 size-12 rounded-full shadow-lg"
					onClick={() => setOpen(true)}
					size="icon"
				>
					<Sparkles />
				</Button>
			)}
			<Drawer chat={chat} onClose={close} open={open} />
		</>
	);
}
