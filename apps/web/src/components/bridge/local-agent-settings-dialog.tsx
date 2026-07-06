import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@better-agent/ui/components/dialog";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@better-agent/ui/components/tabs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { BridgeTokenRow } from "@/utils/api-types";
import { orpc } from "@/utils/orpc";
import {
	type ConfigDraft,
	ConfigTab,
	configFromDraft,
	toDraft,
} from "./local-agent-config-form";
import { AGENT_KIND_LABEL } from "./local-agent-kind-icon";

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

/** The mutation that persists the edited config, invalidating the token list so
 * the detail page reflects the saved values. Only mounted while the dialog is
 * open (the host lazy-mounts it), so the panel that holds the trigger never
 * pays for the react-query wiring. */
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

/**
 * Phase 4 Settings modal for a local agent: left tabs (General + the agent's
 * startup config), right content. Edits the token's persisted `config`
 * (appendSystemPrompt, effort, maxTurns, maxBudgetUsd — see
 * docs/research/agent-config-claude-code.md) which the bridge CLI fetches at
 * session start and applies (currently claude-code). Controlled
 * (`open`/`onOpenChange`) and trigger-less so the host can lazy-mount it.
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
						onSubmit={() =>
							save.mutate({ config: configFromDraft(draft), id: token.id })
						}
						pending={save.isPending}
						token={token}
					/>
				</Tabs>
			</DialogContent>
		</Dialog>
	);
}
