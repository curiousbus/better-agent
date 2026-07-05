import { dispatchToolCall } from "./internal";
import type { RunEvent, RunOptions } from "./types";

interface StrippedTool {
	description: string;
	name: string;
	parameters: Record<string, unknown>;
}

interface PromptInput {
	attachmentIds?: string[];
	sessionId: string;
	text: string;
	tools?: StrippedTool[];
}

export interface PromptToolStreamArgs {
	options: RunOptions | undefined;
	prompt(
		input: PromptInput,
		opts: { signal?: AbortSignal }
	): Promise<AsyncIterable<RunEvent>>;
	sessionId: string;
	submit(input: {
		callId: string;
		isError: boolean;
		result: string;
		sessionId: string;
	}): Promise<unknown>;
	text: string;
}

function strip(tools: RunOptions["tools"]): StrippedTool[] | undefined {
	return tools?.map(({ name, description, parameters }) => ({
		name,
		description,
		parameters,
	}));
}

/** Stream a prompt, dispatching local tool calls and submitting their results. */
export async function* streamPromptWithTools(
	args: PromptToolStreamArgs
): AsyncGenerator<RunEvent> {
	const { options, sessionId } = args;
	const events = await args.prompt(
		{
			sessionId,
			text: args.text,
			tools: strip(options?.tools),
			attachmentIds: options?.attachmentIds,
		},
		{ signal: options?.signal }
	);
	const dispatches: Promise<void>[] = [];
	for await (const event of events) {
		yield event;
		if (event.type === "tool-call" && options?.tools) {
			const tools = options.tools;
			dispatches.push(
				dispatchToolCall(tools, event, (r) =>
					args
						.submit({
							sessionId,
							callId: r.callId,
							result: r.result,
							isError: r.isError,
						})
						.then(() => undefined)
				)
			);
		}
	}
	await Promise.all(dispatches);
}
