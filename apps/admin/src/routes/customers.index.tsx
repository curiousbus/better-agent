import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	type AdminCustomerRow,
	CustomersTable,
} from "@/components/customers/customers-table";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { useListView } from "@/components/list/use-list-view";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/customers/")({
	component: CustomersPage,
});

function matchCustomer(row: AdminCustomerRow, query: string): boolean {
	return row.email.toLowerCase().includes(query);
}

function CustomersPage() {
	const customersQuery = useQuery(orpc.admin.listCustomers.queryOptions());
	const view = useListView(customersQuery.data ?? [], {
		filter: matchCustomer,
	});

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 overflow-auto p-6">
			<ListToolbar
				onSearch={view.setSearch}
				placeholder="Search by email"
				search={view.search}
			/>
			<div className="rounded-lg">
				<CustomersTable
					isLoading={customersQuery.isLoading}
					rows={view.pageRows}
				/>
			</div>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
		</div>
	);
}
