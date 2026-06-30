import { Button } from "@better-agent/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@better-agent/ui/components/dialog";
import { Input } from "@better-agent/ui/components/input";
import { Label } from "@better-agent/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { createCode, TOKEN_KEY } from "@/api";

interface CreateDialogProps {
	onCreated: () => void;
}

interface FormFields {
	label: string;
	source: string;
}

function CreateForm({
	fields,
	onChange,
}: {
	fields: FormFields;
	onChange: (fields: FormFields) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col gap-1">
				<Label htmlFor="create-label">Label</Label>
				<Input
					id="create-label"
					onChange={(e) => onChange({ ...fields, label: e.target.value })}
					placeholder="Optional label"
					type="text"
					value={fields.label}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor="create-source">Source</Label>
				<Input
					id="create-source"
					onChange={(e) => onChange({ ...fields, source: e.target.value })}
					placeholder="Optional source"
					type="text"
					value={fields.source}
				/>
			</div>
		</div>
	);
}

export function CreateDialog({ onCreated }: CreateDialogProps) {
	const [open, setOpen] = useState(false);
	const [fields, setFields] = useState<FormFields>({ label: "", source: "" });

	const mutation = useMutation({
		mutationFn: (input: FormFields) =>
			createCode(localStorage.getItem(TOKEN_KEY), input),
		onSuccess: () => {
			setOpen(false);
			setFields({ label: "", source: "" });
			onCreated();
		},
	});

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		mutation.mutate(fields);
	}

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger render={<Button />}>Create code</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create code</DialogTitle>
				</DialogHeader>
				<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
					<CreateForm fields={fields} onChange={setFields} />
					{mutation.isError && (
						<p className="text-destructive text-xs">{mutation.error.message}</p>
					)}
					<DialogFooter showCloseButton>
						<Button disabled={mutation.isPending} type="submit">
							{mutation.isPending ? "Creating…" : "Create"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
