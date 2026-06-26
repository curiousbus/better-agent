import type { AppRouter } from "@better-agent/api/routers/index";
import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
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
	ReturnType<RouterClient<AppRouter>["admin"]["listUsers"]>
>[number];

const COLUMN_COUNT = 6;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

interface RowHandlers {
	isPendingAdmin: boolean;
	meId: string | undefined;
	onDelete: (row: AdminUserRow) => void;
	onToggleAdmin: (row: AdminUserRow) => void;
}

function UserActions({
	row,
	isSelf,
	isPendingAdmin,
	onToggleAdmin,
	onDelete,
}: {
	row: AdminUserRow;
	isSelf: boolean;
	isPendingAdmin: boolean;
	onToggleAdmin: () => void;
	onDelete: () => void;
}) {
	return (
		<div className="flex items-center justify-end gap-1">
			<Button
				disabled={isSelf || isPendingAdmin}
				onClick={onToggleAdmin}
				size="xs"
				variant={row.isAdmin ? "secondary" : "outline"}
			>
				{row.isAdmin ? "Revoke admin" : "Make admin"}
			</Button>
			{isSelf ? (
				<Button disabled size="xs" variant="destructive">
					Delete
				</Button>
			) : (
				<DeleteConfirm label={`Delete ${row.email}?`} onConfirm={onDelete} />
			)}
		</div>
	);
}

function UserTableRow({
	row,
	handlers,
}: {
	row: AdminUserRow;
	handlers: RowHandlers;
}) {
	return (
		<TableRow>
			<TableCell className="font-medium">{row.email}</TableCell>
			<TableCell>
				<Badge variant={row.emailVerified ? "secondary" : "outline"}>
					{row.emailVerified ? "verified" : "unverified"}
				</Badge>
			</TableCell>
			<TableCell>
				<Badge variant="outline">
					{row.hasPassword ? "password" : "magic"}
				</Badge>
			</TableCell>
			<TableCell>
				{row.isAdmin ? (
					<Badge>admin</Badge>
				) : (
					<span className="text-muted-foreground">—</span>
				)}
			</TableCell>
			<TableCell className="text-muted-foreground">
				{dateFormatter.format(new Date(row.createdAt))}
			</TableCell>
			<TableCell className="text-right">
				<UserActions
					isPendingAdmin={handlers.isPendingAdmin}
					isSelf={handlers.meId === row.id}
					onDelete={() => handlers.onDelete(row)}
					onToggleAdmin={() => handlers.onToggleAdmin(row)}
					row={row}
				/>
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
				{isLoading ? "Loading…" : "No users found."}
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
					<TableHead>Auth</TableHead>
					<TableHead>Role</TableHead>
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
