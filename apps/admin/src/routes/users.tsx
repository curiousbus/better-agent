import { Input } from "@better-agent/ui/components/input";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AddStaffDialog } from "@/components/users/add-staff-dialog";
import { UsersPagination } from "@/components/users/users-pagination";
import { type AdminUserRow, UsersTable } from "@/components/users/users-table";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/users")({
	component: UsersPage,
});

const PAGE_SIZE = 10;

function useDeleteStaff() {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.admin.deleteStaff.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.admin.listStaff.key() }),
			onError: (error: Error) => toast.error(error.message),
		})
	);
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
		<div className="relative flex-1">
			<SearchIcon className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				aria-label="Search staff by email"
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
	const staffQuery = useQuery(orpc.admin.listStaff.queryOptions());
	const meQuery = useQuery(orpc.auth.me.queryOptions());
	const remove = useDeleteStaff();

	const filtered = useFilteredUsers(staffQuery.data, search);
	const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
	const safePage = Math.min(page, totalPages);
	const pageRows = filtered.slice(
		(safePage - 1) * PAGE_SIZE,
		safePage * PAGE_SIZE
	);

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<div className="flex items-center gap-2">
				<UsersSearch
					onChange={(value) => {
						setSearch(value);
						setPage(1);
					}}
					value={search}
				/>
				<AddStaffDialog />
			</div>
			<div className="rounded-lg border">
				<UsersTable
					handlers={{
						meId: meQuery.data?.id,
						onDelete: (row) => remove.mutate({ userId: row.id }),
					}}
					isLoading={staffQuery.isLoading}
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
