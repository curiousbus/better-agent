import { Badge } from "@better-agent/ui/components/badge";
import { cn } from "@better-agent/ui/lib/utils";
import {
	AlertTriangleIcon,
	FileEditIcon,
	InfoIcon,
	WrenchIcon,
} from "lucide-react";
import type {
	ErrorEvent,
	FileEvent,
	MessageEvent,
	NormalizedEvent,
	OutputEvent,
	StatusEvent,
	ToolEvent,
} from "./bridge-events";

function MessageLine({ event }: { event: MessageEvent }) {
	const isUser = event.role === "user";
	return (
		<p
			className={cn(
				"whitespace-pre-wrap",
				event.thinking && "italic opacity-70"
			)}
		>
			<span
				className={cn(
					"mr-1.5 font-semibold",
					isUser ? "text-primary" : "text-foreground"
				)}
			>
				{isUser ? "›" : "‹"}
			</span>
			{event.text}
		</p>
	);
}

const TOOL_STATUS_STYLES: Record<ToolEvent["status"], string> = {
	started: "text-muted-foreground",
	completed: "text-muted-foreground",
	failed: "text-destructive",
};

function ToolLine({ event }: { event: ToolEvent }) {
	return (
		<p
			className={cn(
				"flex items-center gap-1.5",
				TOOL_STATUS_STYLES[event.status]
			)}
		>
			<WrenchIcon className="size-3.5 shrink-0" />
			<span className="font-medium">{event.name}</span>
			<span className="opacity-70">{event.status}</span>
		</p>
	);
}

const FILE_CHANGE_LABEL: Record<FileEvent["change"], string> = {
	created: "+",
	modified: "~",
	deleted: "-",
};

function FileLine({ event }: { event: FileEvent }) {
	return (
		<p className="flex items-center gap-1.5">
			<FileEditIcon className="size-3.5 shrink-0 text-muted-foreground" />
			<Badge variant="outline">
				{FILE_CHANGE_LABEL[event.change]} {event.path}
			</Badge>
		</p>
	);
}

function OutputLine({ event }: { event: OutputEvent }) {
	return (
		<pre
			className={cn(
				"whitespace-pre-wrap break-all rounded-md bg-muted/50 px-2 py-1",
				event.stream === "stderr" && "text-destructive"
			)}
		>
			{event.text}
		</pre>
	);
}

function StatusLine({ event }: { event: StatusEvent }) {
	return (
		<p className="flex items-center gap-1.5 text-muted-foreground italic">
			<InfoIcon className="size-3.5 shrink-0" />
			{event.status}
		</p>
	);
}

function ErrorLine({ event }: { event: ErrorEvent }) {
	return (
		<p className="flex items-center gap-1.5 text-destructive">
			<AlertTriangleIcon className="size-3.5 shrink-0" />
			{event.message}
		</p>
	);
}

/** Renders one normalized bridge event, styled distinctly per `kind`. */
export function EventLine({ event }: { event: NormalizedEvent }) {
	switch (event.kind) {
		case "message":
			return <MessageLine event={event} />;
		case "tool":
			return <ToolLine event={event} />;
		case "file":
			return <FileLine event={event} />;
		case "output":
			return <OutputLine event={event} />;
		case "status":
			return <StatusLine event={event} />;
		case "error":
			return <ErrorLine event={event} />;
		default:
			return null;
	}
}
