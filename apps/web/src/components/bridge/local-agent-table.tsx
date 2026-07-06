import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useNavigate } from "@tanstack/react-router";
import type { KeyboardEvent } from "react";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import { localAgentDisplayName } from "./local-agent-format";
import type { LocalAgentEntry } from "./local-agent-join";
import { AGENT_KIND_LABEL, AgentKindIcon } from "./local-agent-kind-icon";
import { LocalAgentStatusChip } from "./local-agent-status-chip";

const COLUMN_COUNT = 5;
const ENTER_KEY = "Enter";

const createdFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

export interface LocalAgentTableRow {
	entry: LocalAgentEntry;
	sessionCount: number;
}

function AgentCell({ entry }: { entry: LocalAgentEntry }) {
	const { token } = entry;
	return (
		<div className="flex min-w-0 items-center gap-2">
			<AgentKindIcon
				className="size-4 shrink-0 text-muted-foreground"
				kind={token.agentKind}
			/>
			<div className="flex min-w-0 flex-col">
				<span className="truncate font-medium">
					{localAgentDisplayName(entry)}
				</span>
				<span className="truncate text-muted-foreground text-xs">
					{AGENT_KIND_LABEL[token.agentKind]}
				</span>
			</div>
		</div>
	);
}

/** The delete control, isolated so its clicks/keys — including those from its
 * portaled confirm popup, which bubble through React's tree back to the row —
 * never trigger the row's navigate handler. */
function RowActions({
	entry,
	onDelete,
}: {
	entry: LocalAgentEntry;
	onDelete: (tokenId: string) => void;
}) {
	const stop = (event: { stopPropagation: () => void }) =>
		event.stopPropagation();
	return (
		// biome-ignore lint/a11y/noNoninteractiveElementInteractions: guards row navigation only
		// biome-ignore lint/a11y/noStaticElementInteractions: guards row navigation only
		<span className="inline-flex" onClick={stop} onKeyDown={stop}>
			<DeleteConfirm
				label={`Delete ${localAgentDisplayName(entry)}? Its token and all sessions are removed.`}
				onConfirm={() => onDelete(entry.token.id)}
			/>
		</span>
	);
}

function AgentRow({
	row,
	onDelete,
}: {
	row: LocalAgentTableRow;
	onDelete: (tokenId: string) => void;
}) {
	const navigate = useNavigate();
	const { entry, sessionCount } = row;
	const open = () =>
		navigate({
			params: { tokenId: entry.token.id },
			to: "/local-agents/$tokenId",
		});
	const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
		if (event.key === ENTER_KEY) {
			open();
		}
	};
	return (
		<TableRow
			className="cursor-pointer"
			onClick={open}
			onKeyDown={onKeyDown}
			tabIndex={0}
		>
			<TableCell>
				<AgentCell entry={entry} />
			</TableCell>
			<TableCell>
				<LocalAgentStatusChip status={entry.status} />
			</TableCell>
			<TableCell className="text-muted-foreground tabular-nums">
				{sessionCount}
			</TableCell>
			<TableCell className="text-muted-foreground tabular-nums">
				{createdFormatter.format(new Date(entry.token.createdAt))}
			</TableCell>
			<TableCell className="text-right">
				<RowActions entry={entry} onDelete={onDelete} />
			</TableCell>
		</TableRow>
	);
}

/** The Local Agents list as a table: one row per bridge token with its agent
 * kind, live status, session count and created date. Rows link to the agent's
 * detail page; the Actions cell deletes the token (after confirm) without
 * triggering that navigation. */
export function LocalAgentTable({
	rows,
	onDelete,
}: {
	rows: LocalAgentTableRow[];
	onDelete: (tokenId: string) => void;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Agent</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Sessions</TableHead>
					<TableHead>Created</TableHead>
					<TableHead className="text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{rows.length === 0 ? (
					<TableRow>
						<TableCell
							className="h-24 text-center text-muted-foreground"
							colSpan={COLUMN_COUNT}
						>
							No local agents yet — add one to start streaming a session here.
						</TableCell>
					</TableRow>
				) : (
					rows.map((row) => (
						<AgentRow key={row.entry.token.id} onDelete={onDelete} row={row} />
					))
				)}
			</TableBody>
		</Table>
	);
}
