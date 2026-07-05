import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@better-agent/ui/components/card";
import { cn } from "@better-agent/ui/lib/utils";
import {
	AlertTriangleIcon,
	CheckIcon,
	FileEditIcon,
	InfoIcon,
	WrenchIcon,
} from "lucide-react";
import type {
	ApprovalEvent,
	ErrorEvent,
	FileEvent,
	MessageEvent,
	NormalizedEvent,
	OutputEvent,
	StatusEvent,
	ToolEvent,
} from "./bridge-events";

const DEFAULT_OPTION_INDEX = 0;

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

export interface ApprovalLineProps {
	answeredOptionId?: string;
	event: ApprovalEvent;
	onAnswer?: (requestId: string, optionId: string) => void;
	pending: boolean;
}

/**
 * Approval request card: title + optional detail + one button per option.
 * The first option is the "allow"-style default action, the rest render as
 * outline buttons. Once `answeredOptionId` is set — either from this
 * session's own click or a replayed event for an already-answered
 * `requestId` — every button disables and the chosen one shows a check.
 */
function ApprovalLine({
	answeredOptionId,
	event,
	onAnswer,
	pending,
}: ApprovalLineProps) {
	const disabled = answeredOptionId !== undefined || pending;
	return (
		<Card className="gap-2 font-sans" size="sm">
			<CardHeader>
				<CardTitle>{event.title}</CardTitle>
				{event.detail && <CardDescription>{event.detail}</CardDescription>}
			</CardHeader>
			<CardContent className="flex flex-wrap gap-2">
				{event.options.map((option, index) => {
					const chosen = answeredOptionId === option.id;
					return (
						<Button
							disabled={disabled}
							key={option.id}
							onClick={() => onAnswer?.(event.requestId, option.id)}
							size="sm"
							type="button"
							variant={index === DEFAULT_OPTION_INDEX ? "default" : "outline"}
						>
							{chosen && <CheckIcon className="size-3.5" />}
							{option.label}
							{chosen && <span className="sr-only"> (chosen)</span>}
						</Button>
					);
				})}
			</CardContent>
		</Card>
	);
}

export interface EventLineProps {
	/** requestId -> chosen optionId, for approvals already answered. */
	answeredApprovals?: Record<string, string>;
	/** True while a sendInput mutation is in flight — disables not-yet
	 * answered approval buttons so a second click can't fire a second send. */
	approvalPending?: boolean;
	event: NormalizedEvent;
	onAnswerApproval?: (requestId: string, optionId: string) => void;
}

/** Renders one normalized bridge event, styled distinctly per `kind`. */
export function EventLine({
	answeredApprovals,
	approvalPending,
	event,
	onAnswerApproval,
}: EventLineProps) {
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
		case "approval":
			return (
				<ApprovalLine
					answeredOptionId={answeredApprovals?.[event.requestId]}
					event={event}
					onAnswer={onAnswerApproval}
					pending={approvalPending ?? false}
				/>
			);
		default:
			return null;
	}
}
