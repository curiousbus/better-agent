import { Skeleton } from "@better-agent/ui/components/skeleton";
import { ORPCError } from "@orpc/client";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";
import { useEffect } from "react";
import { toast } from "sonner";

import { ActivityTimeline } from "@/components/customers/activity-timeline";
import { CustomerInfoCard } from "@/components/customers/customer-info-card";
import { CustomerUsageSection } from "@/components/customers/customer-usage-section";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/customers/$userId")({
	component: CustomerDetailPage,
});

function isNotFound(error: unknown): boolean {
	return error instanceof ORPCError && error.code === "NOT_FOUND";
}

function useCustomerNotFoundRedirect(error: unknown) {
	const navigate = useNavigate();
	useEffect(() => {
		if (isNotFound(error)) {
			toast.error("Customer not found");
			navigate({ to: "/customers" });
		}
	}, [error, navigate]);
}

function DetailSkeleton() {
	return (
		<div className="flex flex-col gap-4">
			<Skeleton className="h-24 w-full" />
			<Skeleton className="h-48 w-full" />
		</div>
	);
}

function BackLink() {
	return (
		<Link
			className="flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
			to="/customers"
		>
			<ArrowLeftIcon className="size-4" />
			Customers
		</Link>
	);
}

function CustomerDetailPage() {
	const { userId } = Route.useParams();
	const customerQuery = useQuery(
		orpc.admin.getCustomer.queryOptions({ input: { userId } })
	);
	useCustomerNotFoundRedirect(customerQuery.error);

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 overflow-auto p-6">
			<BackLink />
			{customerQuery.data ? (
				<CustomerInfoCard customer={customerQuery.data} />
			) : (
				<DetailSkeleton />
			)}
			<CustomerUsageSection userId={userId} />
			<ActivityTimeline userId={userId} />
		</div>
	);
}
