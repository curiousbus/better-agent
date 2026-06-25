import type { AgentParams } from "../agent/types";

/** Builds the optional sampling settings spread into the streamText call. */
export function buildSettings(params: AgentParams | null): {
	temperature?: number;
	topP?: number;
	maxOutputTokens?: number;
} {
	const settings: {
		temperature?: number;
		topP?: number;
		maxOutputTokens?: number;
	} = {};
	if (params?.temperature != null) {
		settings.temperature = params.temperature;
	}
	if (params?.topP != null) {
		settings.topP = params.topP;
	}
	if (params?.maxOutputTokens != null) {
		settings.maxOutputTokens = params.maxOutputTokens;
	}
	return settings;
}
