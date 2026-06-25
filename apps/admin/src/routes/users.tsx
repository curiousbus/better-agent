import type { AppRouter } from "@better-agent/api/routers/index";
import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import type { RouterClient } from "@orpc/server";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { DeleteConfirm } from "@/components/list/delete-confirm";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/users")({
	component: UsersPage,
});

type AdminUserRow = Awaited<
	ReturnType<RouterClient<AppRouter>["admin"]["listUsers"]>
>[number];

function UserRow({
	row,
	isSelf,
	onToggleAdmin,
	onDelete,
	isPendingAdmin,
}: {
	row: AdminUserRow;
	isSelf: boolean;
	onToggleAdmin: () => void;
	onDelete: () => void;
	isPendingAdmin: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-accent">
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<span className="truncate font-medium text-sm">{row.email}</span>
				<Badge variant={row.emailVerified ? "secondary" : "outline"}>
					{row.emailVerified ? "verified" : "unverified"}
				</Badge>
				{row.hasPassword ? (
					<Badge variant="outline">password</Badge>
				) : (
					<Badge variant="outline">magic</Badge>
				)}
				{row.isAdmin ? <Badge variant="default">admin</Badge> : null}
			</div>
			<div className="flex shrink-0 items-center gap-1">
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
		</div>
	);
}

function UsersList() {
	const queryClient = useQueryClient();
	const usersQuery = useQuery(orpc.admin.listUsers.queryOptions());
	const meQuery = useQuery(orpc.auth.me.queryOptions());

	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.admin.listUsers.key() });

	const setAdminMutation = useMutation(
		orpc.admin.setUserAdmin.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.error(error.message),
		})
	);

	const deleteMutation = useMutation(
		orpc.admin.deleteUser.mutationOptions({
			onSuccess: invalidate,
			onError: (error) => toast.error(error.message),
		})
	);

	const users = usersQuery.data ?? [];
	const meId = meQuery.data?.id;

	return (
		<div className="flex flex-col">
			{users.map((row) => (
				<UserRow
					isPendingAdmin={setAdminMutation.isPending}
					isSelf={meId === row.id}
					key={row.id}
					onDelete={() => deleteMutation.mutate({ userId: row.id })}
					onToggleAdmin={() =>
						setAdminMutation.mutate({ userId: row.id, isAdmin: !row.isAdmin })
					}
					row={row}
				/>
			))}
		</div>
	);
}

function UsersPage() {
	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<h1 className="font-semibold text-lg">Users</h1>
			<UsersList />
		</div>
	);
}
