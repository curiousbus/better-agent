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
import { ProviderSelect } from "./provider-select";

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

function TextField({
	id,
	label,
	value,
	onChange,
	required,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	required?: boolean;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				onChange={(event) => onChange(event.target.value)}
				required={required}
				value={value}
			/>
		</div>
	);
}

function ProviderField({
	value,
	providers,
	editing,
	onChange,
}: {
	value: string;
	providers: ProviderCatalogRow[];
	editing: boolean;
	onChange: (providerId: string) => void;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor="cred-provider">Provider</Label>
			<ProviderSelect
				ariaLabel="Provider"
				className="w-full"
				disabled={editing}
				id="cred-provider"
				onChange={onChange}
				placeholder="Select…"
				providers={providers}
				value={value}
			/>
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
			<ProviderField
				editing={editing}
				onChange={(value) => setForm({ ...form, providerId: value })}
				providers={providers}
				value={form.providerId}
			/>
			<TextField
				id="cred-key"
				label="API key"
				onChange={(value) => setForm({ ...form, apiKey: value })}
				required
				value={form.apiKey}
			/>
			<TextField
				id="cred-base"
				label="Base URL (optional)"
				onChange={(value) => setForm({ ...form, baseURL: value })}
				value={form.baseURL}
			/>
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
