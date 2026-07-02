// apps/admin/src/components/customers/block-toggle.tsx

import { Button } from "@better-agent/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@better-agent/ui/components/popover";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { orpc } from "@/utils/orpc";

function useBlockMutations(userId: string) {
	const queryClient = useQueryClient();
	const invalidate = () => {
		queryClient.invalidateQueries({
			queryKey: orpc.admin.getCustomer.key({ input: { userId } }),
		});
		queryClient.invalidateQueries({ queryKey: orpc.admin.listCustomers.key() });
		queryClient.invalidateQueries({
			queryKey: orpc.admin.customerActivity.key({ input: { userId } }),
		});
	};
	const block = useMutation(
		orpc.admin.blockUser.mutationOptions({
			onSuccess: () => {
				toast.success("Customer blocked");
				invalidate();
			},
			onError: (error: Error) => toast.error(error.message),
		})
	);
	const unblock = useMutation(
		orpc.admin.unblockUser.mutationOptions({
			onSuccess: () => {
				toast.success("Customer unblocked");
				invalidate();
			},
			onError: (error: Error) => toast.error(error.message),
		})
	);
	return { block, unblock };
}

function BlockConfirm({
	onConfirm,
	pending,
}: {
	onConfirm: () => void;
	pending: boolean;
}) {
	const [open, setOpen] = useState(false);
	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger
				render={<Button disabled={pending} variant="destructive" />}
			>
				Block
			</PopoverTrigger>
			<PopoverContent>
				<PopoverTitle className="text-sm">Block this customer?</PopoverTitle>
				<p className="mt-1 text-muted-foreground text-xs">
					This immediately signs them out everywhere.
				</p>
				<div className="mt-2 flex justify-end gap-2">
					<Button onClick={() => setOpen(false)} size="xs" variant="outline">
						Cancel
					</Button>
					<Button
						onClick={() => {
							setOpen(false);
							onConfirm();
						}}
						size="xs"
						variant="destructive"
					>
						Confirm
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

export function BlockToggle({
	userId,
	blocked,
}: {
	userId: string;
	blocked: boolean;
}) {
	const { block, unblock } = useBlockMutations(userId);

	if (blocked) {
		return (
			<Button
				disabled={unblock.isPending}
				onClick={() => unblock.mutate({ userId })}
				variant="outline"
			>
				Unblock
			</Button>
		);
	}

	return (
		<BlockConfirm
			onConfirm={() => block.mutate({ userId })}
			pending={block.isPending}
		/>
	);
}
