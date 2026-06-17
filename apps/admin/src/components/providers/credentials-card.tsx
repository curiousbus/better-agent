import { Button } from "@better-agent/ui/components/button";
import { Card } from "@better-agent/ui/components/card";
import { Checkbox } from "@better-agent/ui/components/checkbox";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { CredentialRow, ProviderCatalogRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";

interface FormState {
	apiKey: string;
	baseURL: string;
	enabled: boolean;
	providerId: string;
}

const EMPTY_FORM: FormState = {
	providerId: "",
	apiKey: "",
	baseURL: "",
	enabled: true,
};

function ProviderSelect({
	providers,
	value,
	onChange,
}: {
	providers: ProviderCatalogRow[];
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor="cred-provider">Provider</Label>
			<select
				className="h-8 border bg-transparent px-2 text-sm"
				id="cred-provider"
				onChange={(event) => onChange(event.target.value)}
				required
				value={value}
			>
				<option value="">Select…</option>
				{providers.map((provider) => (
					<option key={provider.providerId} value={provider.providerId}>
						{provider.providerId}
					</option>
				))}
			</select>
		</div>
	);
}

function CredentialFormFields({
	form,
	providers,
	setForm,
}: {
	form: FormState;
	providers: ProviderCatalogRow[];
	setForm: (f: FormState) => void;
}) {
	return (
		<>
			<ProviderSelect
				onChange={(v) => setForm({ ...form, providerId: v })}
				providers={providers}
				value={form.providerId}
			/>
			<div className="flex flex-col gap-1">
				<Label htmlFor="cred-key">API key</Label>
				<Input
					id="cred-key"
					onChange={(event) => setForm({ ...form, apiKey: event.target.value })}
					required
					value={form.apiKey}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor="cred-base">Base URL (optional)</Label>
				<Input
					id="cred-base"
					onChange={(event) =>
						setForm({ ...form, baseURL: event.target.value })
					}
					value={form.baseURL}
				/>
			</div>
			<label className="flex items-center gap-2 text-sm" htmlFor="cred-enabled">
				<Checkbox
					checked={form.enabled}
					id="cred-enabled"
					onCheckedChange={(checked) =>
						setForm({ ...form, enabled: checked === true })
					}
				/>
				Enabled
			</label>
		</>
	);
}

function CredentialForm({
	providers,
	onSubmit,
	pending,
}: {
	providers: ProviderCatalogRow[];
	onSubmit: (form: FormState) => void;
	pending: boolean;
}) {
	const [form, setForm] = useState<FormState>(EMPTY_FORM);
	return (
		<form
			className="grid grid-cols-[1fr_1fr_1fr_auto_auto] items-end gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit(form);
				setForm(EMPTY_FORM);
			}}
		>
			<CredentialFormFields
				form={form}
				providers={providers}
				setForm={setForm}
			/>
			<Button disabled={pending} size="sm" type="submit">
				Save
			</Button>
		</form>
	);
}

function CredentialRows({
	rows,
	onDelete,
}: {
	rows: CredentialRow[];
	onDelete: (providerId: string) => void;
}) {
	return (
		<tbody>
			{rows.map((row) => (
				<tr className="border-b/40" key={row.providerId}>
					<td className="py-1 font-mono">{row.providerId}</td>
					<td className="font-mono text-muted-foreground">…{row.last4}</td>
					<td className="text-muted-foreground">{row.baseURL ?? "—"}</td>
					<td>
						<span
							className={
								row.enabled ? "text-green-500" : "text-muted-foreground"
							}
						>
							{row.enabled ? "enabled" : "disabled"}
						</span>
					</td>
					<td className="text-right">
						<Button
							onClick={() => onDelete(row.providerId)}
							size="xs"
							variant="destructive"
						>
							Delete
						</Button>
					</td>
				</tr>
			))}
		</tbody>
	);
}

function useCredentialsMutations(invalidate: () => void) {
	const upsert = useMutation(
		orpc.providers.credentialsUpsert.mutationOptions({
			onSuccess: () => {
				toast.success("Credential saved");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	const remove = useMutation(
		orpc.providers.credentialsDelete.mutationOptions({
			onSuccess: () => {
				toast.success("Credential deleted");
				invalidate();
			},
			onError: (error) => toast.error(error.message),
		})
	);
	return { upsert, remove };
}

export function CredentialsCard() {
	const queryClient = useQueryClient();
	const catalog = useQuery(orpc.providers.catalogList.queryOptions());
	const credentials = useQuery(orpc.providers.credentialsList.queryOptions());
	const invalidate = () =>
		queryClient.invalidateQueries({
			queryKey: orpc.providers.credentialsList.key(),
		});
	const { upsert, remove } = useCredentialsMutations(invalidate);

	return (
		<Card className="flex flex-col gap-4 p-4">
			<h2 className="font-semibold text-lg">Credentials</h2>
			<CredentialForm
				onSubmit={(form) =>
					upsert.mutate({
						providerId: form.providerId,
						apiKey: form.apiKey,
						baseURL: form.baseURL.trim() === "" ? null : form.baseURL.trim(),
						enabled: form.enabled,
					})
				}
				pending={upsert.isPending}
				providers={catalog.data ?? []}
			/>
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
					onDelete={(providerId) => remove.mutate({ providerId })}
					rows={credentials.data ?? []}
				/>
			</table>
		</Card>
	);
}
