import { generateText } from "ai";
import type { ModelFactory } from "../provider/model-factory";
import type { Summarizer } from "./compaction";

const COMPACTION_SYSTEM =
	"You are compacting a long conversation so it can continue within the model's context window. Produce a concise summary that preserves all facts, decisions, code, names, and open questions needed to continue. Output only the summary.";

export function createModelSummarizer(modelFactory: ModelFactory): Summarizer {
	return {
		async summarize({ providerId, modelId, prompt }) {
			const model = await modelFactory.create(providerId, modelId);
			const result = await generateText({
				model,
				system: COMPACTION_SYSTEM,
				prompt,
			});
			return result.text;
		},
	};
}
