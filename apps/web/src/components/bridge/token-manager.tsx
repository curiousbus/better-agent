import { Button } from "@better-agent/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { BridgeTokenRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { BridgeTokenRevealDialog } from "./bridge-token-reveal-dialog";
import { TokenManagerSkeleton } from "./token-manager-skeleton";

function formatDate(value: Date): string {
	return new Date(value).toLocaleDateString();
}

function TokenRows({
	rows,
	onRevoke,
}: {
	rows: BridgeTokenRow[];
	onRevoke: (id: string) => void;
}) {
	return (
		<TableBody>
			{rows.map((row) => (
				<TableRow key={row.id}>
					<TableCell className="font-medium">
						{row.name ?? "Untitled token"}
					</TableCell>
					<TableCell className="font-mono text-muted-foreground">
						•••• {row.last4}
					</TableCell>
					<TableCell className="text-muted-foreground">
						{formatDate(row.createdAt)}
					</TableCell>
					<TableCell className="text-right">
						{row.revokedAt ? (
							<span className="text-muted-foreground text-xs">Revoked</span>
						) : (
							<DeleteConfirm
								label="Revoke this token? Anything using it stops working."
								onConfirm={() => onRevoke(row.id)}
							/>
						)}
					</TableCell>
				</TableRow>
			))}
		</TableBody>
	);
}

function useTokenMutations(onCreated: (token: string) => void) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.bridge.listTokens.key() });
	const create = useMutation(
		orpc.bridge.createToken.mutationOptions({
			onSuccess: (result) => {
				onCreated(result.token);
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const revoke = useMutation(
		orpc.bridge.revokeToken.mutationOptions({
			onSuccess: () => {
				toast.success("Token revoked");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	return { create, revoke };
}

/** Lists bridge tokens, creates new ones (revealed once), and revokes them. */
export function TokenManager() {
	const tokens = useQuery(orpc.bridge.listTokens.queryOptions());
	const [revealToken, setRevealToken] = useState<string | null>(null);
	const { create, revoke } = useTokenMutations(setRevealToken);

	if (tokens.isPending) {
		return <TokenManagerSkeleton />;
	}

	const rows = tokens.data ?? [];

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-2">
				<p className="text-muted-foreground text-sm">
					Bridge tokens let a local CLI stream an agent session into this
					dashboard.
				</p>
				<Button
					disabled={create.isPending}
					onClick={() => create.mutate({})}
					size="sm"
				>
					New token
				</Button>
			</div>
			{rows.length === 0 ? (
				<p className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
					No bridge tokens yet.
				</p>
			) : (
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Token</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TokenRows onRevoke={(id) => revoke.mutate({ id })} rows={rows} />
				</Table>
			)}
			<BridgeTokenRevealDialog
				onClose={() => setRevealToken(null)}
				token={revealToken}
			/>
		</div>
	);
}
