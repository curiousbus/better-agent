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

const PASSWORD_MIN = 8;

function useCreateStaff(onDone: () => void) {
	const queryClient = useQueryClient();
	return useMutation(
		orpc.admin.createStaff.mutationOptions({
			onSuccess: () => {
				queryClient.invalidateQueries({
					queryKey: orpc.admin.listStaff.key(),
				});
				onDone();
			},
			onError: (error) => toast.error(error.message),
		})
	);
}

function StaffForm({ onCreated }: { onCreated: () => void }) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const create = useCreateStaff(() => {
		setEmail("");
		setPassword("");
		onCreated();
	});

	return (
		<form
			className="flex flex-col gap-3"
			onSubmit={(event) => {
				event.preventDefault();
				create.mutate({ email, password });
			}}
		>
			<div className="flex flex-col gap-1">
				<Label htmlFor="staff-email">Email</Label>
				<Input
					id="staff-email"
					onChange={(event) => setEmail(event.target.value)}
					placeholder="staff@example.com"
					required
					type="email"
					value={email}
				/>
			</div>
			<div className="flex flex-col gap-1">
				<Label htmlFor="staff-password">Password</Label>
				<Input
					autoComplete="new-password"
					id="staff-password"
					minLength={PASSWORD_MIN}
					onChange={(event) => setPassword(event.target.value)}
					placeholder="Password"
					required
					type="password"
					value={password}
				/>
			</div>
			<Button className="self-end" disabled={create.isPending} type="submit">
				Add staff
			</Button>
		</form>
	);
}

export function AddStaffDialog() {
	const [open, setOpen] = useState(false);
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger render={<Button size="sm" />}>
				<PlusIcon />
				Add staff
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add staff user</DialogTitle>
				</DialogHeader>
				<StaffForm onCreated={() => setOpen(false)} />
			</DialogContent>
		</Dialog>
	);
}
