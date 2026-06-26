import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

import { DeleteConfirm } from "@/components/list/delete-confirm";
import type { ComposioAccountRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

const COLUMN_COUNT = 4;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

function AccountRow({
	row,
	onDelete,
}: {
	row: ComposioAccountRow;
	onDelete: (id: string) => void;
}) {
	return (
		<TableRow>
			<TableCell className="font-medium">
				<Link
					className="hover:underline"
					params={{ accountId: row.id }}
					to="/composio/$accountId"
				>
					{row.name}
				</Link>
			</TableCell>
			<TableCell className="font-mono text-muted-foreground">
				{`••••${row.apiKeyLast4}`}
			</TableCell>
			<TableCell className="text-muted-foreground">
				{dateFormatter.format(new Date(row.createdAt))}
			</TableCell>
			<TableCell className="text-right">
				<DeleteConfirm
					label={`Delete ${row.name}?`}
					onConfirm={() => onDelete(row.id)}
				/>
			</TableCell>
		</TableRow>
	);
}

export function AccountsTable() {
	const queryClient = useQueryClient();
	const accountsQuery = useQuery(orpc.composio.listAccounts.queryOptions());
	const remove = useMutation(
		orpc.composio.deleteAccount.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({
					queryKey: orpc.composio.listAccounts.key(),
				}),
			onError: (error) => toast.error(error.message),
		})
	);
	const rows = accountsQuery.data ?? [];

	return (
		<div className="rounded-lg border">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>API key</TableHead>
						<TableHead>Created</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{accountsQuery.isLoading || rows.length === 0 ? (
						<TableRow>
							<TableCell
								className="h-24 text-center text-muted-foreground"
								colSpan={COLUMN_COUNT}
							>
								{accountsQuery.isLoading
									? "Loading…"
									: "No composio accounts yet."}
							</TableCell>
						</TableRow>
					) : (
						rows.map((row) => (
							<AccountRow
								key={row.id}
								onDelete={(id) => remove.mutate({ accountId: id })}
								row={row}
							/>
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}
