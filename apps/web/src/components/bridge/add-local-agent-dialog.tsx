import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";
import { BridgeTokenRevealContent } from "./bridge-token-reveal-dialog";

type AddLocalAgentStep = "form" | "reveal";
const DEFAULT_STEP: AddLocalAgentStep = "form";

function useCreateBridgeToken(onCreated: (token: string) => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.bridge.createToken.mutationOptions({
			onSuccess: (result) => {
				onCreated(result.token);
				queryClient.invalidateQueries({
					queryKey: orpc.bridge.listTokens.key(),
				});
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function NameForm({
	name,
	onName,
	onSubmit,
	pending,
}: {
	name: string;
	onName: (value: string) => void;
	onSubmit: () => void;
	pending: boolean;
}) {
	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<div className="flex flex-col gap-1">
				<Label htmlFor="local-agent-name">Name</Label>
				<Input
					id="local-agent-name"
					onChange={(event) => onName(event.target.value)}
					placeholder="e.g. laptop"
					value={name}
				/>
			</div>
			<Button className="self-end" disabled={pending} type="submit">
				{pending ? "Creating…" : "Create"}
			</Button>
		</form>
	);
}

function useAddLocalAgentDialog() {
	const [open, setOpen] = useState(false);
	const [step, setStep] = useState<AddLocalAgentStep>(DEFAULT_STEP);
	const [name, setName] = useState("");
	const [token, setToken] = useState<string | null>(null);

	const create = useCreateBridgeToken((created) => {
		setToken(created);
		setStep("reveal");
	});

	const onOpenChange = (next: boolean) => {
		setOpen(next);
		if (!next) {
			setStep(DEFAULT_STEP);
			setName("");
			setToken(null);
		}
	};

	return { open, onOpenChange, step, name, setName, token, create };
}

/**
 * "Add a local agent" is the existing bridge-token createToken flow, reshaped
 * as a two-step dialog: name it, then reveal the raw token plus the
 * ready-to-run CLI command (`BridgeTokenRevealContent`, shared with the
 * Tokens tab's reveal dialog). The token itself isn't tied to any one
 * agentKind — that's chosen by the CLI's `--agent` flag at connect time.
 */
export function AddLocalAgentDialog() {
	const { open, onOpenChange, step, name, setName, token, create } =
		useAddLocalAgentDialog();

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				Add local agent
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add local agent</DialogTitle>
					{step === "form" ? (
						<DialogDescription>
							Name this connection, then run the generated command from your
							project directory to stream a local agent session here.
						</DialogDescription>
					) : (
						<DialogDescription>
							Copy this token now — it won't be shown again. Anyone with it can
							start bridge sessions as you; revoke it from the Tokens tab if it
							leaks.
						</DialogDescription>
					)}
				</DialogHeader>
				{step === "form" ? (
					<NameForm
						name={name}
						onName={setName}
						onSubmit={() => create.mutate({ name: name.trim() || undefined })}
						pending={create.isPending}
					/>
				) : null}
				{step === "reveal" && token ? (
					<BridgeTokenRevealContent token={token} />
				) : null}
				<DialogFooter showCloseButton />
			</DialogContent>
		</Dialog>
	);
}
