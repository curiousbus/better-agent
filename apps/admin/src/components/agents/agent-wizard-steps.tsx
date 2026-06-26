import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@better-agent/ui/components/select";
import { Textarea } from "@better-agent/ui/components/textarea";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { orpc } from "@/utils/orpc";

import type { AgentForm } from "./agent-form";
import { WIZARD_STEPS } from "./agent-form";

type SetForm = (patch: Partial<AgentForm>) => void;

export function Stepper({ step }: { step: number }) {
	return (
		<div className="flex gap-3 text-sm">
			{WIZARD_STEPS.map((label, index) => (
				<span
					className={
						index === step
							? "font-medium text-foreground"
							: "text-muted-foreground"
					}
					key={label}
				>
					{index + 1}. {label}
				</span>
			))}
		</div>
	);
}

function Field({
	id,
	label,
	children,
}: {
	id: string;
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<Label htmlFor={id}>{label}</Label>
			{children}
		</div>
	);
}

export function IdentityStep({ form, set }: { form: AgentForm; set: SetForm }) {
	return (
		<div className="flex flex-col gap-3">
			<Field id="agent-name" label="Name">
				<Input
					id="agent-name"
					onChange={(event) => set({ name: event.target.value })}
					value={form.name}
				/>
			</Field>
			<Field id="agent-desc" label="Description">
				<Input
					id="agent-desc"
					onChange={(event) => set({ description: event.target.value })}
					value={form.description}
				/>
			</Field>
			<Field id="agent-prompt" label="System prompt">
				<Textarea
					id="agent-prompt"
					onChange={(event) => set({ systemPrompt: event.target.value })}
					rows={5}
					value={form.systemPrompt}
				/>
			</Field>
		</div>
	);
}

function WizardSelect({
	id,
	value,
	onChange,
	placeholder,
	options,
	disabled,
}: {
	id: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	options: string[];
	disabled?: boolean;
}) {
	return (
		<Select
			disabled={disabled}
			onValueChange={(next) => onChange(typeof next === "string" ? next : "")}
			value={value}
		>
			<SelectTrigger className="w-full" id={id}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => (
					<SelectItem key={option} value={option}>
						{option}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

export function ModelStep({ form, set }: { form: AgentForm; set: SetForm }) {
	const credentials = useQuery(orpc.providers.credentialsList.queryOptions());
	const providers = (credentials.data ?? [])
		.filter((row) => row.enabled)
		.map((row) => row.providerId);
	const models = useQuery(
		orpc.providers.modelsList.queryOptions({
			input: { providerId: form.providerId },
			enabled: form.providerId !== "",
		})
	);
	if (providers.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No enabled credentials. Add one on the Providers page first.
			</p>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<Field id="agent-provider" label="Provider">
				<WizardSelect
					id="agent-provider"
					onChange={(value) => set({ providerId: value, modelId: "" })}
					options={providers}
					placeholder="Select a provider…"
					value={form.providerId}
				/>
			</Field>
			<Field id="agent-model" label="Model">
				<WizardSelect
					disabled={form.providerId === ""}
					id="agent-model"
					onChange={(value) => set({ modelId: value })}
					options={(models.data ?? []).map((model) => model.modelId)}
					placeholder="Select a model…"
					value={form.modelId}
				/>
			</Field>
		</div>
	);
}

export function ParamsStep({ form, set }: { form: AgentForm; set: SetForm }) {
	return (
		<div className="flex flex-col gap-3">
			<Field id="agent-temp" label="Temperature (0–2, optional)">
				<Input
					id="agent-temp"
					inputMode="decimal"
					onChange={(event) => set({ temperature: event.target.value })}
					value={form.temperature}
				/>
			</Field>
			<Field id="agent-topp" label="Top P (0–1, optional)">
				<Input
					id="agent-topp"
					inputMode="decimal"
					onChange={(event) => set({ topP: event.target.value })}
					value={form.topP}
				/>
			</Field>
			<Field id="agent-maxout" label="Max output tokens (optional)">
				<Input
					id="agent-maxout"
					inputMode="numeric"
					onChange={(event) => set({ maxOutputTokens: event.target.value })}
					value={form.maxOutputTokens}
				/>
			</Field>
		</div>
	);
}

export { ToolsStep } from "./agent-wizard-tools";
