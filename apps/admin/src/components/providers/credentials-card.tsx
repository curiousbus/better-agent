import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { ListToolbar } from "@/components/list/list-toolbar";
import { Pagination } from "@/components/list/pagination";
import { type ListView, useListView } from "@/components/list/use-list-view";
import type { CredentialRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

import {
	CredentialDialog,
	EMPTY_FORM,
	type FormState,
} from "./credential-dialog";

function matchCredential(row: CredentialRow, query: string): boolean {
	return row.providerId.toLowerCase().includes(query);
}

function DeleteConfirm({ onConfirm }: { onConfirm: () => void }) {
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger render={<Button size="xs" variant="destructive" />}>
				Delete
			</PopoverTrigger>
			<PopoverContent>
				<PopoverTitle className="text-sm">Delete this credential?</PopoverTitle>
				<div className="mt-2 flex justify-end gap-2">
					<Button onClick={() => setOpen(false)} size="xs" variant="outline">
						Cancel
					</Button>
					<Button
						onClick={() => {
							setOpen(false);
							onConfirm();
						}}
						size="xs"
						variant="destructive"
					>
						Confirm
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function CredentialRows({
	rows,
	onEdit,
	onDelete,
}: {
	rows: CredentialRow[];
	onEdit: (row: CredentialRow) => void;
	onDelete: (providerId: string) => void;
}) {
	return (
		<tbody>
			{rows.map((row) => (
				<tr className="border-border/40 border-b" key={row.providerId}>
					<td className="py-1 font-mono">{row.providerId}</td>
					<td className="font-mono text-muted-foreground">…{row.last4}</td>
					<td className="text-muted-foreground">{row.baseURL ?? "—"}</td>
					<td
						className={row.enabled ? "text-green-500" : "text-muted-foreground"}
					>
						{row.enabled ? "enabled" : "disabled"}
					</td>
					<td className="flex justify-end gap-2 py-1">
						<Button onClick={() => onEdit(row)} size="xs" variant="outline">
							Edit
						</Button>
						<DeleteConfirm onConfirm={() => onDelete(row.providerId)} />
					</td>
				</tr>
			))}
		</tbody>
	);
}

function useCredentialDialog() {
	const [dialog, setDialog] = useState<{
		open: boolean;
		initial: FormState | null;
	}>({ open: false, initial: null });
	const openAdd = () => setDialog({ open: true, initial: EMPTY_FORM });
	const openEdit = (row: CredentialRow) =>
		setDialog({
			open: true,
			initial: {
				providerId: row.providerId,
				apiKey: "",
				baseURL: row.baseURL ?? "",
				enabled: row.enabled,
			},
		});
	const close = (open: boolean) => setDialog({ open, initial: dialog.initial });
	return { dialog, openAdd, openEdit, close };
}

function useCredentialsMutations(onSaved: () => void) {
	const queryClient = useQueryClient();
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.providers.credentialsList.key(),
		});
	const upsert = useMutation(
		orpc.providers.credentialsUpsert.mutationOptions({
			onSuccess: () => {
				toast.success("Credential saved");
				onSaved();
				invalidate();
			},
			onError: (e) => toast.error(e.message),
		})
	);
	const remove = useMutation(
		orpc.providers.credentialsDelete.mutationOptions({
			onSuccess: () => {
				toast.success("Credential deleted");
				invalidate();
			},
			onError: (e) => toast.error(e.message),
		})
	);
	return { upsert, remove };
}

function CredentialsTable({
	view,
	onEdit,
	onDelete,
}: {
	view: ListView<CredentialRow>;
	onEdit: (row: CredentialRow) => void;
	onDelete: (providerId: string) => void;
}) {
	return (
		<>
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b text-left text-muted-foreground">
						<th className="py-1 font-medium">Provider</th>
						<th className="font-medium">Key</th>
						<th className="font-medium">Base URL</th>
						<th className="font-medium">Status</th>
						<th />
					</tr>
				</thead>
				<CredentialRows
					onDelete={onDelete}
					onEdit={onEdit}
					rows={view.pageRows}
				/>
			</table>
			<Pagination
				onPage={view.setPage}
				page={view.page}
				pageCount={view.pageCount}
				total={view.total}
			/>
		</>
	);
}

export function CredentialsCard() {
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const credentials = useQuery(orpc.providers.credentialsList.queryOptions());
	const view = useListView(credentials.data ?? [], { filter: matchCredential });
	const { dialog, openAdd, openEdit, close } = useCredentialDialog();
	const { upsert, remove } = useCredentialsMutations(() => close(false));
	const handleSubmit = (form: FormState) =>
		upsert.mutate({
			providerId: form.providerId,
			apiKey: form.apiKey,
			baseURL: form.baseURL.trim() === "" ? null : form.baseURL.trim(),
			enabled: form.enabled,
		});
	return (
		<Card className="flex flex-col gap-3 p-4">
			<h2 className="font-semibold text-lg">Credentials</h2>
			<ListToolbar
				action={
					<Button onClick={openAdd} size="sm">
						Add credential
					</Button>
				}
				onSearch={view.setSearch}
				placeholder="Search credentials…"
				search={view.search}
			/>
			<CredentialsTable
				onDelete={(providerId) => remove.mutate({ providerId })}
				onEdit={openEdit}
				view={view}
			/>
			{dialog.open ? (
				<CredentialDialog
					initial={dialog.initial}
					key={dialog.initial?.providerId ?? "new"}
					onOpenChange={close}
					onSubmit={handleSubmit}
					open={dialog.open}
					pending={upsert.isPending}
					providers={catalog.data ?? []}
				/>
			) : null}
		</Card>
	);
}
