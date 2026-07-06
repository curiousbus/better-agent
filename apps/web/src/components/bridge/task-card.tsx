import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import {
	BotIcon,
	CheckIcon,
	ChevronDownIcon,
	Loader2Icon,
	XIcon,
} from "lucide-react";

const TASK_RESULT_PATTERN = /<task_result>([\s\S]*?)<\/task_result>/;
const TASK_WRAPPER_PATTERN = /^<task\b[^>]*>([\s\S]*)<\/task>\s*$/;

/** Strip the `<task id="..." state="...">…</task>` XML wrapper opencode
 * emits around a subagent's summary, keeping only the human-readable text.
 * Prefers the inner `<task_result>` body when present; falls back to the
 * whole wrapped body, then to the raw text unchanged — Claude's built-in
 * Task tool never wraps its result at all. */
export function stripTaskWrapper(text: string): string {
	const resultMatch = TASK_RESULT_PATTERN.exec(text);
	if (resultMatch) {
		return resultMatch[1].trim();
	}
	const wrapperMatch = TASK_WRAPPER_PATTERN.exec(text.trim());
	if (wrapperMatch) {
		return wrapperMatch[1].trim();
	}
	return text.trim();
}

export interface TaskInvocation {
	callId: string;
	resultText: string;
	status: "running" | "complete" | "error";
	title: string;
}

const TASK_STATUS_LABEL: Record<TaskInvocation["status"], string> = {
	complete: "Done",
	error: "Failed",
	running: "Running…",
};

function TaskStatusIcon({ status }: { status: TaskInvocation["status"] }) {
	if (status === "running") {
		return (
			<Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
		);
	}
	if (status === "error") {
		return <XIcon className="size-3.5 text-destructive" />;
	}
	return <CheckIcon className="size-3.5 text-muted-foreground" />;
}

/**
 * Compact card for a subagent "Task" tool call: the description as the
 * title (with a small robot icon), a collapsible body with the subagent's
 * result (XML wrapper stripped), and the running/complete/error status.
 * Matches the visual language of the plain tool card in `packages/ui`'s
 * `ToolGroup` (border, muted background, collapsible panel) — it can't
 * render through that component directly, since `ToolGroup` only shows a
 * rich body once a call is both complete and non-error, and a task's
 * running/failed states need the card too.
 */
export function TaskCard({ task }: { task: TaskInvocation }) {
	return (
		<Collapsible.Root
			className={cn(
				"rounded-md border bg-muted/40 p-2",
				task.status === "error" && "border-destructive/40"
			)}
			defaultOpen={task.status === "error"}
		>
			<Collapsible.Trigger className="flex w-full items-center gap-1.5 text-left text-muted-foreground text-xs hover:text-foreground">
				<BotIcon className="size-3.5 shrink-0" />
				<span className="truncate font-medium text-foreground">
					{task.title}
				</span>
				<TaskStatusIcon status={task.status} />
				<span className="opacity-70">{TASK_STATUS_LABEL[task.status]}</span>
				<ChevronDownIcon className="ml-auto size-3.5 shrink-0 transition-transform data-[panel-open]:rotate-180" />
			</Collapsible.Trigger>
			<Collapsible.Panel className="mt-2">
				<pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-muted-foreground text-xs">
					{task.resultText || "No result yet."}
				</pre>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}
