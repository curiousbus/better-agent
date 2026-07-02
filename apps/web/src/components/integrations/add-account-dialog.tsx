import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
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

function useCreateAccount(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.composio.createAccount.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.composio.listAccounts.key(),
				});
				toast.success("Account added");
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function AccountForm({ onCreated }: { onCreated: () => void }) {
	const [name, setName] = useState("");
	const [apiKey, setApiKey] = useState("");
	const create = useCreateAccount(() => {
		setName("");
		setApiKey("");
		onCreated();
	});

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				create.mutate({ name, apiKey });
			}}
		>
			<div className="flex flex-col gap-1">
				<Label htmlFor="composio-name">Name</Label>
				<Input
					id="composio-name"
					onChange={(event) => setName(event.target.value)}
					placeholder="e.g. Marketing tools"
					required
					value={name}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor="composio-key">API key</Label>
				<Input
					autoComplete="off"
					id="composio-key"
					onChange={(event) => setApiKey(event.target.value)}
					placeholder="composio API key"
					required
					type="password"
					value={apiKey}
				/>
			</div>
			<Button className="self-end" disabled={create.isPending} type="submit">
				Add account
			</Button>
		</form>
	);
}

export function AddAccountDialog() {
	const [open, setOpen] = useState(false);
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				Add account
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add Composio account</DialogTitle>
				</DialogHeader>
				<AccountForm onCreated={() => setOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}
