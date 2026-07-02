import type { AppRouter } from "@better-agent/api/routers/index";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@better-agent/ui/components/avatar";
import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import type { RouterClient } from "@orpc/server";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon } from "lucide-react";

import { userAvatar } from "@/utils/avatar";

export type AdminCustomerRow = Awaited<
	ReturnType<RouterClient<AppRouter>["admin"]["listCustomers"]>
>[number];

const COLUMN_COUNT = 5;
const dateFormatter = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
});

function CustomerCell({ row }: { row: AdminCustomerRow }) {
	return (
		<div className="flex items-center gap-2">
			<Avatar size="sm">
				<AvatarImage alt={row.email} src={userAvatar(row.email)} />
				<AvatarFallback>{row.email[0]?.toUpperCase()}</AvatarFallback>
			</Avatar>
			<span className="truncate font-medium">{row.email}</span>
		</div>
	);
}

function CustomerTableRow({ row }: { row: AdminCustomerRow }) {
	return (
		<TableRow>
			<TableCell>
				<CustomerCell row={row} />
			</TableCell>
			<TableCell>
				<Badge variant={row.emailVerified ? "secondary" : "outline"}>
					{row.emailVerified ? "verified" : "unverified"}
				</Badge>
			</TableCell>
			<TableCell className="text-muted-foreground">
				{dateFormatter.format(new Date(row.createdAt))}
			</TableCell>
			<TableCell>
				<Badge variant={row.blocked ? "destructive" : "secondary"}>
					{row.blocked ? "Blocked" : "Active"}
				</Badge>
			</TableCell>
			<TableCell className="text-right">
				<Button
					aria-label={`View ${row.email}`}
					render={<Link params={{ userId: row.id }} to="/customers/$userId" />}
					size="xs"
					variant="ghost"
				>
					<ChevronRightIcon className="size-4" />
				</Button>
			</TableCell>
		</TableRow>
	);
}

function EmptyRow({ isLoading }: { isLoading: boolean }) {
	return (
		<TableRow>
			<TableCell
				className="h-24 text-center text-muted-foreground"
				colSpan={COLUMN_COUNT}
			>
				{isLoading ? "Loading…" : "No customers yet."}
			</TableCell>
		</TableRow>
	);
}

export function CustomersTable({
	rows,
	isLoading,
}: {
	rows: AdminCustomerRow[];
	isLoading: boolean;
}) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Customer</TableHead>
					<TableHead>Verified</TableHead>
					<TableHead>Joined</TableHead>
					<TableHead>Status</TableHead>
					<TableHead className="text-right">Actions</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{isLoading || rows.length === 0 ? (
					<EmptyRow isLoading={isLoading} />
				) : (
					rows.map((row) => <CustomerTableRow key={row.id} row={row} />)
				)}
			</TableBody>
		</Table>
	);
}
