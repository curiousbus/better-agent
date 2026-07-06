import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@better-agent/ui/components/tabs";
import { Textarea } from "@better-agent/ui/components/textarea";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { BridgeTokenRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import { AGENT_KIND_LABEL } from "./local-agent-kind-icon";

/** The persisted config shape this dialog edits (mirrors the server's
 * `BridgeTokenConfig`). `maxTurns` is held as a string while editing so the
 * number input can be cleared; it's parsed back on save. */
interface ConfigDraft {
	appendSystemPrompt: string;
	maxTurns: string;
}

function toDraft(config: BridgeTokenRow["config"]): ConfigDraft {
	return {
		appendSystemPrompt: config?.appendSystemPrompt ?? "",
		maxTurns: config?.maxTurns === undefined ? "" : String(config.maxTurns),
	};
}

/** Agent kinds whose bridge adapter actually reads + applies the persisted
 * config today. Others persist it but silently ignore it, so their Config tab
 * shows a "not yet configurable" note instead of fields that do nothing. */
const CONFIGURABLE_AGENT_KINDS = new Set<BridgeTokenRow["agentKind"]>([
	"claude-code",
]);

function agentAppliesConfig(kind: BridgeTokenRow["agentKind"]): boolean {
	return CONFIGURABLE_AGENT_KINDS.has(kind);
}

function isValidMaxTurns(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

/** Builds the persisted-config payload from the edit draft: drops blanks so an
 * empty field clears the value, and parses `maxTurns` back to a number.
 * Extracted so the dialog stays under the max-lines-per-function gate. */
function configFromDraft(draft: ConfigDraft): {
	appendSystemPrompt?: string;
	maxTurns?: number;
} {
	const maxTurnsRaw = draft.maxTurns.trim();
	const maxTurns = maxTurnsRaw === "" ? undefined : Number(maxTurnsRaw);
	return {
		appendSystemPrompt: draft.appendSystemPrompt.trim() || undefined,
		...(maxTurns !== undefined && isValidMaxTurns(maxTurns)
			? { maxTurns }
			: {}),
	};
}

function GeneralTab({ token }: { token: BridgeTokenRow }) {
	return (
		<TabsContent value="general">
			<dl className="flex flex-col gap-3 text-sm">
				<div className="flex items-center justify-between gap-4">
					<dt className="text-muted-foreground">Agent</dt>
					<dd className="font-medium">{AGENT_KIND_LABEL[token.agentKind]}</dd>
				</div>
				<div className="flex items-center justify-between gap-4">
					<dt className="text-muted-foreground">Name</dt>
					<dd className="font-medium">{token.name ?? "Untitled"}</dd>
				</div>
			</dl>
		</TabsContent>
	);
}

/** Builds the mutation that persists the edited config, invalidating the token
 * list so the detail page reflects the saved values. */
function useUpdateConfig(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.bridge.updateTokenConfig.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listTokens.key(),
				});
				toast.success("Settings saved");
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

interface AgentConfigFormProps {
	draft: ConfigDraft;
	onDraft: (next: ConfigDraft) => void;
	onSubmit: () => void;
	pending: boolean;
}

/** The append-system-prompt field — split out so `AgentConfigForm` stays under
 * the max-lines-per-function gate. */
function AppendSystemPromptField({
	draft,
	onDraft,
}: {
	draft: ConfigDraft;
	onDraft: (next: ConfigDraft) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<Label htmlFor="append-system-prompt">Append system prompt</Label>
			<Textarea
				className="min-h-28"
				id="append-system-prompt"
				onChange={(event) =>
					onDraft({ ...draft, appendSystemPrompt: event.target.value })
				}
				placeholder="Extra instructions appended to the agent's system prompt at launch."
				value={draft.appendSystemPrompt}
			/>
			<p className="text-muted-foreground text-xs">
				Applied on the next session start (claude-code only for now).
			</p>
		</div>
	);
}

/** The per-agent startup config form (claude-code fields for now; other agents
 * extend this same pattern — see the Phase 4 plan). */
function AgentConfigForm({
	draft,
	onDraft,
	onSubmit,
	pending,
}: AgentConfigFormProps) {
	return (
		<form
			className="flex flex-col gap-4"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<AppendSystemPromptField draft={draft} onDraft={onDraft} />
			<div className="flex flex-col gap-2">
				<Label htmlFor="max-turns">Max turns</Label>
				<Input
					id="max-turns"
					min={1}
					onChange={(event) =>
						onDraft({ ...draft, maxTurns: event.target.value })
					}
					placeholder="Unlimited"
					type="number"
					value={draft.maxTurns}
				/>
			</div>
			<DialogFooter className="gap-2">
				<Button disabled={pending} type="submit">
					{pending ? "Saving…" : "Save"}
				</Button>
			</DialogFooter>
		</form>
	);
}

/** The "Config" tab: the startup-config form for agents whose adapter actually
 * applies it, or an honest note for those it doesn't (so no one saves settings
 * that silently never take effect). Split out to keep the dialog under the
 * max-lines-per-function gate. */
function ConfigTab({
	token,
	draft,
	onDraft,
	onSubmit,
	pending,
}: AgentConfigFormProps & { token: BridgeTokenRow }) {
	return (
		<TabsContent value="config">
			{agentAppliesConfig(token.agentKind) ? (
				<AgentConfigForm
					draft={draft}
					onDraft={onDraft}
					onSubmit={onSubmit}
					pending={pending}
				/>
			) : (
				<p className="text-muted-foreground text-sm">
					{AGENT_KIND_LABEL[token.agentKind]} has no page-configurable startup
					settings yet — its options aren't wired through the bridge. Only
					claude-code is configurable for now.
				</p>
			)}
		</TabsContent>
	);
}

/**
 * Phase 4 Settings modal for a local agent: left tabs (General + the agent's
 * startup config), right content. Edits the token's persisted `config`
 * (appendSystemPrompt, maxTurns) which the bridge CLI fetches at session start
 * and applies (currently claude-code). Controlled (`open`/`onOpenChange`) and
 * trigger-less so the host panel can lazy-mount it — the react-query wiring
 * only spins up once opened.
 */
export function LocalAgentSettingsDialog({
	open,
	onOpenChange,
	token,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	token: BridgeTokenRow;
}) {
	const [draft, setDraft] = useState<ConfigDraft>(() => toDraft(token.config));

	// Re-seed the draft whenever the dialog opens so it reflects the latest
	// persisted config (not a stale edit from a previous open).
	useEffect(() => {
		if (open) {
			setDraft(toDraft(token.config));
		}
	}, [open, token.config]);

	const save = useUpdateConfig(() => onOpenChange(false));

	const submit = () => {
		save.mutate({ config: configFromDraft(draft), id: token.id });
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>Agent settings</DialogTitle>
				</DialogHeader>
				<Tabs defaultValue="general" orientation="vertical">
					<TabsList>
						<TabsTrigger value="general">General</TabsTrigger>
						<TabsTrigger value="config">Config</TabsTrigger>
					</TabsList>
					<GeneralTab token={token} />
					<ConfigTab
						draft={draft}
						onDraft={setDraft}
						onSubmit={submit}
						pending={save.isPending}
						token={token}
					/>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
