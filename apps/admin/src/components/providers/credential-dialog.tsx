import { Button } from "@better-agent/ui/components/button";
import { Checkbox } from "@better-agent/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useState } from "react";

import type { ProviderCatalogRow } from "@/utils/api-types";

export interface FormState {
	apiKey: string;
	baseURL: string;
	enabled: boolean;
	providerId: string;
}

export const EMPTY_FORM: FormState = {
	providerId: "",
	apiKey: "",
	baseURL: "",
	enabled: true,
};

function ProviderSelect({
	providers,
	value,
	onChange,
	disabled,
}: {
	providers: ProviderCatalogRow[];
	value: string;
	onChange: (v: string) => void;
	disabled: boolean;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor="cred-provider">Provider</Label>
			<select
				className="h-8 border bg-transparent px-2 text-sm disabled:opacity-60"
				disabled={disabled}
				id="cred-provider"
				onChange={(e) => onChange(e.target.value)}
				required
				value={value}
			>
				<option value="">Select…</option>
				{providers.map((p) => (
					<option key={p.providerId} value={p.providerId}>
						{p.providerId}
					</option>
				))}
			</select>
		</div>
	);
}

function CredentialFields({
	form,
	setForm,
	providers,
	editing,
}: {
	form: FormState;
	setForm: (f: FormState) => void;
	providers: ProviderCatalogRow[];
	editing: boolean;
}) {
	return (
		<div className="flex flex-col gap-3">
			<ProviderSelect
				disabled={editing}
				onChange={(v) => setForm({ ...form, providerId: v })}
				providers={providers}
				value={form.providerId}
			/>
			<div className="flex flex-col gap-1">
				<Label htmlFor="cred-key">API key</Label>
				<Input
					id="cred-key"
					onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
					required
					value={form.apiKey}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor="cred-base">Base URL (optional)</Label>
				<Input
					id="cred-base"
					onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
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
		</div>
	);
}

function DialogActions({
	pending,
	onCancel,
}: {
	pending: boolean;
	onCancel: () => void;
}) {
	return (
		<div className="flex justify-end gap-2">
			<Button onClick={onCancel} size="sm" type="button" variant="outline">
				Cancel
			</Button>
			<Button disabled={pending} size="sm" type="submit">
				Save
			</Button>
		</div>
	);
}

export function CredentialDialog({
	open,
	onOpenChange,
	initial,
	providers,
	onSubmit,
	pending,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	initial: FormState | null;
	providers: ProviderCatalogRow[];
	onSubmit: (form: FormState) => void;
	pending: boolean;
}) {
	const [form, setForm] = useState<FormState>(initial ?? EMPTY_FORM);
	const editing = (initial?.providerId ?? "") !== "";
	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{editing ? "Edit credential" : "Add credential"}
					</DialogTitle>
				</DialogHeader>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						onSubmit(form);
					}}
				>
					<CredentialFields
						editing={editing}
						form={form}
						providers={providers}
						setForm={setForm}
					/>
					<DialogActions
						onCancel={() => onOpenChange(false)}
						pending={pending}
					/>
				</form>
			</DialogContent>
		</Dialog>
	);
}
