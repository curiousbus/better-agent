import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import type { Code } from "@/api";

function UsedText({ code }: { code: Code }) {
	if (!code.active) {
		return <span className="text-muted-foreground">revoked</span>;
	}
	return (
		<span>
			{code.redemptions}/{code.maxRedemptions}
		</span>
	);
}

interface RevokeCellProps {
	code: Code;
	isConfirming: boolean;
	onConfirmRequest: (id: string | null) => void;
	onRevoke: (id: string) => void;
}

function RevokeActions({
	code,
	isConfirming,
	onRevoke,
	onConfirmRequest,
}: RevokeCellProps) {
	if (isConfirming) {
		return (
			<div className="flex items-center gap-1">
				<Button
					onClick={() => {
						onRevoke(code.id);
						onConfirmRequest(null);
					}}
					size="xs"
					variant="destructive"
				>
					Confirm?
				</Button>
				<Button
					onClick={() => onConfirmRequest(null)}
					size="xs"
					variant="outline"
				>
					Cancel
				</Button>
			</div>
		);
	}
	return (
		<Button
			onClick={() => onConfirmRequest(code.id)}
			size="xs"
			variant="destructive"
		>
			Revoke
		</Button>
	);
}

export interface CodeCardProps {
	code: Code;
	confirmingId: string | null;
	onConfirmRequest: (id: string | null) => void;
	onRevoke: (id: string) => void;
}

export function CodeCard({
	code,
	confirmingId,
	onRevoke,
	onConfirmRequest,
}: CodeCardProps) {
	return (
		<div className="rounded-md border bg-card p-3 text-card-foreground shadow-sm">
			<div className="mb-2 font-mono text-xs">{code.code}</div>
			<div className="flex flex-col gap-1 text-sm">
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground">Label</span>
					<span>{code.label || "—"}</span>
				</div>
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground">Source</span>
					<Badge variant="secondary">{code.source}</Badge>
				</div>
				<div className="flex items-center justify-between">
					<span className="text-muted-foreground">Used</span>
					<UsedText code={code} />
				</div>
			</div>
			{code.active && (
				<div className="mt-3">
					<RevokeActions
						code={code}
						isConfirming={confirmingId === code.id}
						onConfirmRequest={onConfirmRequest}
						onRevoke={onRevoke}
					/>
				</div>
			)}
		</div>
	);
}
