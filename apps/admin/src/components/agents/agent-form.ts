import type { AgentRow } from "@/utils/api-types";

export interface AgentForm {
	description: string;
	maxOutputTokens: string;
	modelId: string;
	name: string;
	providerId: string;
	systemPrompt: string;
	temperature: string;
	topP: string;
}

export const EMPTY_AGENT_FORM: AgentForm = {
	name: "",
	description: "",
	systemPrompt: "",
	providerId: "",
	modelId: "",
	temperature: "",
	topP: "",
	maxOutputTokens: "",
};

export const WIZARD_STEPS = ["Identity", "Model", "Params"] as const;

const IDENTITY_STEP = 0;
const MODEL_STEP = 1;
const LAST_STEP = WIZARD_STEPS.length - 1;

export function isStepValid(step: number, form: AgentForm): boolean {
	if (step === IDENTITY_STEP) {
		return (
			form.name.trim() !== "" &&
			form.description.trim() !== "" &&
			form.systemPrompt.trim() !== ""
		);
	}
	if (step === MODEL_STEP) {
		return form.providerId !== "" && form.modelId !== "";
	}
	return true;
}

export function isLastStep(step: number): boolean {
	return step === LAST_STEP;
}

function toNumber(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === "") {
		return null;
	}
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

function toParams(form: AgentForm) {
	const temperature = toNumber(form.temperature);
	const topP = toNumber(form.topP);
	const maxOutputTokens = toNumber(form.maxOutputTokens);
	if (temperature === null && topP === null && maxOutputTokens === null) {
		return null;
	}
	return { temperature, topP, maxOutputTokens };
}

export function toAgentInput(form: AgentForm) {
	return {
		name: form.name,
		description: form.description,
		systemPrompt: form.systemPrompt,
		providerId: form.providerId,
		modelId: form.modelId,
		params: toParams(form),
	};
}

export function agentRowToForm(row: AgentRow): AgentForm {
	return {
		name: row.name,
		description: row.description,
		systemPrompt: row.systemPrompt,
		providerId: row.providerId,
		modelId: row.modelId,
		temperature: row.params?.temperature?.toString() ?? "",
		topP: row.params?.topP?.toString() ?? "",
		maxOutputTokens: row.params?.maxOutputTokens?.toString() ?? "",
	};
}
