import { Input } from "@better-agent/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UsersPagination } from "@/components/users/users-pagination";
import { type AdminUserRow, UsersTable } from "@/components/users/users-table";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/users")({
	component: UsersPage,
});

const PAGE_SIZE = 10;

function useUserMutations() {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.admin.listUsers.key() });
	const onError = (error: Error) => toast.error(error.message);
	const setAdmin = useMutation(
		orpc.admin.setUserAdmin.mutationOptions({ onSuccess: invalidate, onError })
	);
	const remove = useMutation(
		orpc.admin.deleteUser.mutationOptions({ onSuccess: invalidate, onError })
	);
	return { setAdmin, remove };
}

function useFilteredUsers(data: AdminUserRow[] | undefined, search: string) {
	return useMemo(() => {
		const term = search.trim().toLowerCase();
		const all = data ?? [];
		return term
			? all.filter((row) => row.email.toLowerCase().includes(term))
			: all;
	}, [data, search]);
}

function UsersSearch({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="relative">
			<SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				aria-label="Search users by email"
				className="pl-8"
				onChange={(event) => onChange(event.target.value)}
				placeholder="Search by email"
				value={value}
			/>
		</div>
	);
}

function UsersPage() {
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(1);
	const usersQuery = useQuery(orpc.admin.listUsers.queryOptions());
	const meQuery = useQuery(orpc.auth.me.queryOptions());
	const { setAdmin, remove } = useUserMutations();

	const filtered = useFilteredUsers(usersQuery.data, search);
	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const safePage = Math.min(page, totalPages);
	const pageRows = filtered.slice(
		(safePage - 1) * PAGE_SIZE,
		safePage * PAGE_SIZE
	);

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<UsersSearch
				onChange={(value) => {
					setSearch(value);
					setPage(1);
				}}
				value={search}
			/>
			<div className="rounded-lg border">
				<UsersTable
					handlers={{
						meId: meQuery.data?.id,
						isPendingAdmin: setAdmin.isPending,
						onToggleAdmin: (row) =>
							setAdmin.mutate({ userId: row.id, isAdmin: !row.isAdmin }),
						onDelete: (row) => remove.mutate({ userId: row.id }),
					}}
					isLoading={usersQuery.isLoading}
					rows={pageRows}
				/>
			</div>
			<UsersPagination
				onPage={setPage}
				page={safePage}
				totalPages={totalPages}
			/>
		</div>
	);
}
