import { Button } from "@better-agent/ui/components/button";
import { Link } from "@tanstack/react-router";
import { MessageSquareIcon, PencilIcon } from "lucide-react";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { AgentRow } from "@/utils/api-types";
import { RegenerateToken } from "./agent-token-controls";

interface RowActionProps {
	onDelete: (id: string) => void;
	onEdit: (row: AgentRow) => void;
	onTokenRotated: (token: string) => void;
	row: AgentRow;
}

// All actions are icon buttons (hover shows the label) for a consistent row.
export function AgentRowActions({
	row,
	onEdit,
	onDelete,
	onTokenRotated,
}: RowActionProps) {
	return (
		<div className="flex justify-end gap-1">
			<Button
				aria-label="Chat"
				render={<Link search={{ agentId: row.id }} to="/chat" />}
				size="icon-xs"
				title="Chat"
				variant="ghost"
			>
				<MessageSquareIcon className="size-4" />
			</Button>
			<Button
				aria-label="Edit"
				onClick={() => onEdit(row)}
				size="icon-xs"
				title="Edit"
				variant="ghost"
			>
				<PencilIcon className="size-4" />
			</Button>
			<RegenerateToken agentId={row.id} onToken={onTokenRotated} />
			<DeleteConfirm
				label="Delete this agent?"
				onConfirm={() => onDelete(row.id)}
			/>
		</div>
	);
}
