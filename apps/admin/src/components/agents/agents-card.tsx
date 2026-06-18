import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
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
import { useState } from "react";
import { toast } from "sonner";

import { DeleteConfirm } from "@/components/list/delete-confirm";
import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { type ListView, useListView } from "@/components/list/use-list-view";
import type { AgentRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

import { type AgentForm, agentRowToForm, toAgentInput } from "./agent-form";
import { AgentWizard } from "./agent-wizard";

function matchAgent(row: AgentRow, query: string): boolean {
	return (
		row.name.toLowerCase().includes(query) ||
		row.providerId.toLowerCase().includes(query) ||
		row.modelId.toLowerCase().includes(query)
	);
}

function AgentRows({
	rows,
	onEdit,
	onDelete,
}: {
	rows: AgentRow[];
	onEdit: (row: AgentRow) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<TableBody>
			{rows.map((row) => (
				<TableRow key={row.id}>
					<TableCell className="font-medium">
						<Link
							className="hover:underline"
							params={{ agentId: row.id }}
							to="/agents/$agentId"
						>
							{row.name}
						</Link>
					</TableCell>
					<TableCell className="font-mono text-muted-foreground">
						{row.providerId}/{row.modelId}
					</TableCell>
					<TableCell className="max-w-xs truncate text-muted-foreground">
						{row.description}
					</TableCell>
					<TableCell className="text-right">
						<div className="flex justify-end gap-2">
							<Button onClick={() => onEdit(row)} size="xs" variant="outline">
								Edit
							</Button>
							<DeleteConfirm
								label="Delete this agent?"
								onConfirm={() => onDelete(row.id)}
							/>
						</div>
					</TableCell>
				</TableRow>
			))}
		</TableBody>
	);
}

function AgentsTable({
	view,
	onEdit,
	onDelete,
}: {
	view: ListView<AgentRow>;
	onEdit: (row: AgentRow) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Model</TableHead>
						<TableHead>Description</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<AgentRows onDelete={onDelete} onEdit={onEdit} rows={view.pageRows} />
			</Table>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
		</>
	);
}

function useAgentWizard() {
	const [state, setState] = useState<{
		open: boolean;
		id: string | null;
		initial: AgentForm | null;
	}>({ open: false, id: null, initial: null });
	const openAdd = () => setState({ open: true, id: null, initial: null });
	const openEdit = (row: AgentRow) =>
		setState({ open: true, id: row.id, initial: agentRowToForm(row) });
	const close = (open: boolean) => setState((s) => ({ ...s, open }));
	return { state, openAdd, openEdit, close };
}

function useAgentMutations(onSaved: () => void) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({ queryKey: orpc.agents.list.key() });
	const create = useMutation(
		orpc.agents.create.mutationOptions({
			onSuccess: () => {
				toast.success("Agent created");
				onSaved();
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const update = useMutation(
		orpc.agents.update.mutationOptions({
			onSuccess: () => {
				toast.success("Agent updated");
				onSaved();
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const remove = useMutation(
		orpc.agents.delete.mutationOptions({
			onSuccess: () => {
				toast.success("Agent deleted");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	return { create, update, remove };
}

export function AgentsCard() {
	const agents = useQuery(orpc.agents.list.queryOptions());
	const view = useListView(agents.data ?? [], { filter: matchAgent });
	const { state, openAdd, openEdit, close } = useAgentWizard();
	const { create, update, remove } = useAgentMutations(() => close(false));
	const handleSubmit = (form: AgentForm) => {
		const input = toAgentInput(form);
		if (state.id === null) {
			create.mutate(input);
		} else {
			update.mutate({ id: state.id, ...input });
		}
	};
	return (
		<Card className="flex flex-col gap-3 p-4">
			<ListToolbar
				action={
					<Button onClick={openAdd} size="sm">
						Add agent
					</Button>
				}
				onSearch={view.setSearch}
				placeholder="Search agents…"
				search={view.search}
			/>
			<AgentsTable
				onDelete={(id) => remove.mutate({ id })}
				onEdit={openEdit}
				view={view}
			/>
			{state.open ? (
				<AgentWizard
					initial={state.initial}
					key={state.id ?? "new"}
					onOpenChange={close}
					onSubmit={handleSubmit}
					open={state.open}
					pending={create.isPending || update.isPending}
				/>
			) : null}
		</Card>
	);
}
