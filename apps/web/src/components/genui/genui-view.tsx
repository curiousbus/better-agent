import { Button } from "@better-agent/ui/components/button";
import { GenerativeUI } from "@better-agent/ui/components/genui/generative-ui";
import {
	type AgentClient,
	defineComponents,
	type UIAction,
} from "@curiousbus/agent-client";
import { useMemo, useRef, useState } from "react";
import { HANDLERS, routeAction } from "@/genui/handlers";
import { MANIFEST } from "@/genui/manifest";
import { RENDERERS } from "@/genui/renderers";
import { DATA_TOOLS } from "@/genui/tools";

interface StreamOptions {
	agentClient: AgentClient;
	outputSchema: Record<string, unknown>;
	sessionId: string;
}

async function runStream(
	text: string,
	opts: StreamOptions,
	onDelta: (partial: unknown) => void,
	onDone: (structured: unknown) => void
): Promise<void> {
	for await (const ev of opts.agentClient.stream(text, {
		sessionId: opts.sessionId,
		outputSchema: opts.outputSchema,
		tools: DATA_TOOLS,
	})) {
		if (ev.type === "structured-delta") {
			onDelta(ev.partial);
		} else if (ev.type === "done") {
			onDone(ev.structured ?? null);
		}
	}
}

interface PromptStreamResult {
	busy: boolean;
	run: (text: string) => Promise<void>;
	tree: unknown;
}

function usePromptStream(
	agentClient: AgentClient,
	outputSchema: Record<string, unknown>
): PromptStreamResult {
	const [tree, setTree] = useState<unknown>(null);
	const [busy, setBusy] = useState(false);
	const sessionIdRef = useRef<string>(crypto.randomUUID());

	const run = async (text: string): Promise<void> => {
		setBusy(true);
		try {
			await runStream(
				text,
				{
					agentClient,
					outputSchema,
					sessionId: sessionIdRef.current,
				},
				(partial) => setTree(partial),
				(structured) => setTree(structured)
			);
		} finally {
			setBusy(false);
		}
	};

	return { tree, busy, run };
}

function handleSubmit(
	e: React.FormEvent<HTMLFormElement>,
	text: string,
	busy: boolean,
	run: (text: string) => Promise<void>,
	setText: (v: string) => void
): void {
	e.preventDefault();
	const trimmed = text.trim();
	if (trimmed && !busy) {
		run(trimmed).catch(() => undefined);
		setText("");
	}
}

export function GenerativeUIView({
	agentClient,
}: {
	agentClient: AgentClient;
}): React.ReactNode {
	const ui = useMemo(() => defineComponents(MANIFEST), []);
	const { tree, busy, run } = usePromptStream(agentClient, ui.outputSchema);
	const [text, setText] = useState("");

	const onAction = (action: UIAction): void =>
		routeAction(action, {
			handlers: HANDLERS,
			sendAgentEvent: (a) => {
				run(
					`[ui-event] intent=${a.intent} payload=${JSON.stringify(a.payload ?? null)}`
				).catch(() => undefined);
			},
		});

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4">
			<form
				className="flex gap-2"
				onSubmit={(e) => handleSubmit(e, text, busy, run, setText)}
			>
				<input
					className="flex-1 rounded border px-3 py-2"
					onChange={(e) => setText(e.target.value)}
					placeholder="Describe a UI to generate…"
					value={text}
				/>
				<Button disabled={busy} type="submit">
					{busy ? "Generating…" : "Generate"}
				</Button>
			</form>
			<div className="rounded-lg border p-4">
				<GenerativeUI onAction={onAction} renderers={RENDERERS} tree={tree} />
			</div>
		</div>
	);
}
