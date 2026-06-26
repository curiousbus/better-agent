import type { AgentRow } from "@/utils/api-types";

export interface AgentForm {
	composioToolkits: string[];
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
	composioToolkits: [],
	name: "",
	description: "",
	systemPrompt: "",
	providerId: "",
	modelId: "",
	temperature: "",
	topP: "",
	maxOutputTokens: "",
};

export const WIZARD_STEPS = ["Identity", "Model", "Params", "Tools"] as const;

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
		composioToolkits: form.composioToolkits,
		name: form.name,
		description: form.description,
		systemPrompt: form.systemPrompt,
		providerId: form.providerId,
		modelId: form.modelId,
		params: toParams(form),
	};
}

function numToStr(value: number | null | undefined): string {
	return value?.toString() ?? "";
}

export function agentRowToForm(row: AgentRow): AgentForm {
	return {
		composioToolkits: row.composioToolkits ?? [],
		name: row.name,
		description: row.description,
		systemPrompt: row.systemPrompt,
		providerId: row.providerId,
		modelId: row.modelId,
		temperature: numToStr(row.params?.temperature),
		topP: numToStr(row.params?.topP),
		maxOutputTokens: numToStr(row.params?.maxOutputTokens),
	};
}
