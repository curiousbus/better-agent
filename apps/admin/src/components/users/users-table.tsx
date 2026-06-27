import type { AppRouter } from "@better-agent/api/routers/index";
import { Badge } from "@better-agent/ui/components/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import type { RouterClient } from "@orpc/server";

import { DeleteConfirm } from "@/components/list/delete-confirm";

export type AdminUserRow = Awaited<
	ReturnType<RouterClient<AppRouter>["admin"]["listStaff"]>
>[number];

const COLUMN_COUNT = 4;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

interface RowHandlers {
	meId: string | undefined;
	onDelete: (row: AdminUserRow) => void;
}

function UserTableRow({
	row,
	handlers,
}: {
	row: AdminUserRow;
	handlers: RowHandlers;
}) {
	const isSelf = handlers.meId === row.id;
	return (
		<TableRow>
			<TableCell className="font-medium">{row.email}</TableCell>
			<TableCell>
				<Badge variant={row.emailVerified ? "secondary" : "outline"}>
					{row.emailVerified ? "verified" : "unverified"}
				</Badge>
			</TableCell>
			<TableCell className="text-muted-foreground">
				{dateFormatter.format(new Date(row.createdAt))}
			</TableCell>
			<TableCell className="text-right">
				{isSelf ? (
					<span className="text-muted-foreground text-xs">you</span>
				) : (
					<DeleteConfirm
						label={`Delete ${row.email}?`}
						onConfirm={() => handlers.onDelete(row)}
					/>
				)}
			</TableCell>
		</TableRow>
	);
}

function EmptyRow({ isLoading }: { isLoading: boolean }) {
	return (
		<TableRow>
			<TableCell
				className="h-24 text-center text-muted-foreground"
				colSpan={COLUMN_COUNT}
			>
				{isLoading ? "Loading…" : "No staff yet."}
			</TableCell>
		</TableRow>
	);
}

export function UsersTable({
	rows,
	isLoading,
	handlers,
}: {
	rows: AdminUserRow[];
	isLoading: boolean;
	handlers: RowHandlers;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Email</TableHead>
					<TableHead>Email status</TableHead>
					<TableHead>Joined</TableHead>
					<TableHead className="text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{isLoading || rows.length === 0 ? (
					<EmptyRow isLoading={isLoading} />
				) : (
					rows.map((row) => (
						<UserTableRow handlers={handlers} key={row.id} row={row} />
					))
				)}
			</TableBody>
		</Table>
	);
}
