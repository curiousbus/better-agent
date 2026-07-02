// apps/admin/src/components/customers/customer-info-card.tsx

import type { AppRouter } from "@better-agent/api/routers/index";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import { Badge } from "@better-agent/ui/components/badge";
import { Card } from "@better-agent/ui/components/card";
import type { RouterClient } from "@orpc/server";

import { BlockToggle } from "@/components/customers/block-toggle";
import { userAvatar } from "@/utils/avatar";

export type AdminCustomerDetail = Awaited<
	ReturnType<RouterClient<AppRouter>["admin"]["getCustomer"]>
>;

const dateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

function InfoRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-muted-foreground text-xs">{label}</span>
			<span className="text-sm">{value}</span>
		</div>
	);
}

export function CustomerInfoCard({
	customer,
}: {
	customer: AdminCustomerDetail;
}) {
	return (
		<Card className="flex flex-row items-center justify-between gap-4 p-4">
			<div className="flex items-center gap-4">
				<Avatar size="lg">
					<AvatarImage alt={customer.email} src={userAvatar(customer.email)} />
					<AvatarFallback>{customer.email[0]?.toUpperCase()}</AvatarFallback>
				</Avatar>
				<div className="flex flex-col gap-1">
					<div className="flex items-center gap-2">
						<span className="font-medium text-sm">{customer.email}</span>
						<Badge variant={customer.blocked ? "destructive" : "secondary"}>
							{customer.blocked ? "Blocked" : "Active"}
						</Badge>
					</div>
					<div className="flex flex-wrap gap-x-6 gap-y-1">
						<InfoRow
							label="Joined"
							value={dateFormatter.format(new Date(customer.createdAt))}
						/>
						<InfoRow
							label="Email verified"
							value={customer.emailVerified ? "Yes" : "No"}
						/>
						<InfoRow label="Agents" value={String(customer.agentCount)} />
						{customer.blocked && customer.blockedAt ? (
							<InfoRow
								label="Blocked at"
								value={dateFormatter.format(new Date(customer.blockedAt))}
							/>
						) : null}
					</div>
				</div>
			</div>
			<BlockToggle blocked={customer.blocked} userId={customer.id} />
		</Card>
	);
}
