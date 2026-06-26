import { Badge } from "@better-agent/ui/components/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { ComposioConnectionRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

const COLUMN_COUNT = 3;

function useDisconnect() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.composio.disconnect.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({
					queryKey: orpc.composio.connections.key(),
				}),
			onError: (error) => toast.error(error.message),
		})
	);
}

function ConnectionRow({
	row,
	onDisconnect,
}: {
	row: ComposioConnectionRow;
	onDisconnect: () => void;
}) {
	return (
		<TableRow>
			<TableCell className="font-medium">{row.toolkitSlug}</TableCell>
			<TableCell>
				<Badge variant={row.active ? "secondary" : "outline"}>
					{row.status}
				</Badge>
			</TableCell>
			<TableCell className="text-right">
				<DeleteConfirm
					label={`Disconnect ${row.toolkitSlug}?`}
					onConfirm={onDisconnect}
				/>
			</TableCell>
		</TableRow>
	);
}

export function ConnectionsSection({ accountId }: { accountId: string }) {
	const connections = useQuery(
		orpc.composio.connections.queryOptions({ input: { accountId } })
	);
	const disconnect = useDisconnect();
	const rows = connections.data ?? [];
	const empty = connections.isLoading || rows.length === 0;

	return (
		<div className="flex flex-col gap-2">
			<h2 className="font-medium text-sm">Authenticated toolkits</h2>
			<div className="rounded-lg border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Toolkit</TableHead>
							<TableHead>Status</TableHead>
							<TableHead className="text-right">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{empty ? (
							<TableRow>
								<TableCell
									className="h-20 text-center text-muted-foreground"
									colSpan={COLUMN_COUNT}
								>
									{connections.isLoading
										? "Loading…"
										: "No toolkits authenticated yet."}
								</TableCell>
							</TableRow>
						) : (
							rows.map((row) => (
								<ConnectionRow
									key={row.id}
									onDisconnect={() =>
										disconnect.mutate({ accountId, connectionId: row.id })
									}
									row={row}
								/>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
