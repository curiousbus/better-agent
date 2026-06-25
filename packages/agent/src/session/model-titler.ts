import { generateText } from "ai";
import type { ModelFactory } from "../provider/model-factory";
import type { Titler } from "./titler";

const TITLE_SYSTEM =
	"Generate a concise chat title (max 6 words) for a conversation that starts with the user's message. Output only the title — no quotes, no trailing punctuation.";

export function createModelTitler(modelFactory: ModelFactory): Titler {
	return {
		async title({ providerId, modelId, userText }) {
			const model = await modelFactory.create(providerId, modelId);
			const result = await generateText({
				model,
				system: TITLE_SYSTEM,
				prompt: userText,
			});
			return result.text.trim();
		},
	};
}
