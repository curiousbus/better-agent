import { Collapsible } from "@base-ui/react/collapsible";
import { cn } from "@better-agent/ui/lib/utils";
import {
	CheckIcon,
	ChevronDownIcon,
	Loader2Icon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ToolInvocation } from "./chat-blocks";

const MAX_VALUE_CHARS = 2000;

/** An app-supplied hook: render a rich component for a successful tool
 * result, or return null to keep the raw-JSON tool block. */
export type RenderToolResult = (
	toolName: string,
	result: unknown
) => ReactNode | null;

function formatValue(value: unknown): string {
	if (value === undefined) {
		return "";
	}
	let text: string;
	if (typeof value === "string") {
		text = value;
	} else {
		try {
			text = JSON.stringify(value, null, 2);
		} catch {
			text = String(value);
		}
	}
	return text.length > MAX_VALUE_CHARS
		? `${text.slice(0, MAX_VALUE_CHARS)}\n…(truncated)`
		: text;
}

function StatusIcon({ status }: { status: ToolInvocation["status"] }) {
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

// A registered renderer only ever runs against a completed, successful call —
// isError and in-flight results keep the plain JSON section (or the error
// banner above it).
function richResult(
	tool: ToolInvocation,
	renderToolResult?: RenderToolResult
): ReactNode | null {
	if (tool.isError || tool.status !== "complete" || !renderToolResult) {
		return null;
	}
	return renderToolResult(tool.toolName, tool.result);
}

function ToolResultSection({
	tool,
	rich,
}: {
	tool: ToolInvocation;
	rich: ReactNode | null;
}) {
	if (tool.status === "running") {
		return null;
	}
	if (rich !== null) {
		return (
			<div className="flex flex-col gap-1">
				<span className="text-muted-foreground text-xs uppercase tracking-wide">
					Result
				</span>
				{rich}
			</div>
		);
	}
	return <ToolSection label="Result" value={formatValue(tool.result)} />;
}

function ToolInvocationView({
	tool,
	renderToolResult,
}: {
	tool: ToolInvocation;
	renderToolResult?: RenderToolResult;
}) {
	const rich = richResult(tool, renderToolResult);
	// Errored calls open by default so the failure reason is visible without a
	// click, and the reason also shows as an inline banner on the trigger row.
	return (
		<Collapsible.Root
			className={cn(
				"rounded-md border bg-muted/40 p-2",
				tool.isError && "border-destructive/40"
			)}
			defaultOpen={tool.isError}
		>
			<Collapsible.Trigger className="flex w-full items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground">
				<WrenchIcon className="size-3.5" />
				<span className="font-mono">{tool.toolName}</span>
				<StatusIcon status={tool.status} />
				<ChevronDownIcon className="ml-auto size-3.5 transition-transform data-[panel-open]:rotate-180" />
			</Collapsible.Trigger>
			{tool.isError ? (
				<p className="mt-1.5 break-words text-destructive text-xs">
					{formatValue(tool.result) || "Tool call failed."}
				</p>
			) : null}
			<Collapsible.Panel className="mt-2 flex flex-col gap-2">
				<ToolSection label="Arguments" value={formatValue(tool.args)} />
				<ToolResultSection rich={rich} tool={tool} />
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

function ToolSection({ label, value }: { label: string; value: string }) {
	if (value === "") {
		return null;
	}
	return (
		<div className="flex flex-col gap-1">
			<span className="text-muted-foreground text-xs uppercase tracking-wide">
				{label}
			</span>
			<pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-muted-foreground text-xs">
				{value}
			</pre>
		</div>
	);
}

export function ToolGroup({
	tools,
	renderToolResult,
}: {
	tools: ToolInvocation[];
	renderToolResult?: RenderToolResult;
}) {
	if (tools.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-2">
			{tools.map((tool) => (
				<ToolInvocationView
					key={tool.callId}
					renderToolResult={renderToolResult}
					tool={tool}
				/>
			))}
		</div>
	);
}
