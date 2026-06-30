import { Badge } from "@better-agent/ui/components/badge";
import { Button } from "@better-agent/ui/components/button";
import { Input } from "@better-agent/ui/components/input";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@better-agent/ui/components/pagination";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@better-agent/ui/components/table";
import { useState } from "react";
import type { Code } from "@/api";
import { CodeCard } from "@/components/code-card";
import { clampPage, filterCodes, pageCount, pageOf } from "@/lib/codes";

function UsedCell({ code }: { code: Code }) {
	if (!code.active) {
		return <span className="text-muted-foreground">revoked</span>;
	}
	return (
		<span>
			{code.redemptions}/{code.maxRedemptions}
		</span>
	);
}

interface CodeRowProps {
	code: Code;
	confirmingId: string | null;
	onConfirmRequest: (id: string | null) => void;
	onRevoke: (id: string) => void;
}

function RevokeCell({
	code,
	isConfirming,
	onRevoke,
	onConfirmRequest,
}: {
	code: Code;
	isConfirming: boolean;
	onRevoke: (id: string) => void;
	onConfirmRequest: (id: string | null) => void;
}) {
	if (!code.active) {
		return null;
	}
	if (isConfirming) {
		return (
			<div className="flex items-center gap-1">
				<Button
					onClick={() => {
						onRevoke(code.id);
						onConfirmRequest(null);
					}}
					size="xs"
					variant="destructive"
				>
					Confirm?
				</Button>
				<Button
					onClick={() => onConfirmRequest(null)}
					size="xs"
					variant="outline"
				>
					Cancel
				</Button>
			</div>
		);
	}
	return (
		<Button
			onClick={() => onConfirmRequest(code.id)}
			size="xs"
			variant="destructive"
		>
			Revoke
		</Button>
	);
}

function CodeRow({
	code,
	confirmingId,
	onRevoke,
	onConfirmRequest,
}: CodeRowProps) {
	return (
		<TableRow key={code.id}>
			<TableCell>
				<code className="font-mono text-xs">{code.code}</code>
			</TableCell>
			<TableCell>{code.label}</TableCell>
			<TableCell>
				<Badge variant="secondary">{code.source}</Badge>
			</TableCell>
			<TableCell>
				<UsedCell code={code} />
			</TableCell>
			<TableCell>
				<RevokeCell
					code={code}
					isConfirming={confirmingId === code.id}
					onConfirmRequest={onConfirmRequest}
					onRevoke={onRevoke}
				/>
			</TableCell>
		</TableRow>
	);
}

interface CodesTableProps {
	codes: Code[];
	onRevoke: (id: string) => void;
}

function buildPageNumbers(total: number): number[] {
	const pages: number[] = [];
	for (let i = 0; i < total; i++) {
		pages.push(i);
	}
	return pages;
}

function CodesToolbar({
	query,
	onQuery,
}: {
	query: string;
	onQuery: (q: string) => void;
}) {
	return (
		<div className="mb-3 flex flex-wrap gap-2">
			<Input
				className="min-w-0 flex-1"
				onChange={(e) => onQuery(e.target.value)}
				placeholder="Search codes, labels, sources…"
				type="search"
				value={query}
			/>
		</div>
	);
}

function CodesPagination({
	page,
	total,
	onPage,
}: {
	page: number;
	total: number;
	onPage: (p: number) => void;
}) {
	const pages = buildPageNumbers(total);
	return (
		<Pagination className="mt-3">
			<PaginationContent>
				<PaginationItem>
					<PaginationPrevious
						disabled={page === 0}
						onClick={() => onPage(page - 1)}
					/>
				</PaginationItem>
				{pages.map((p) => (
					<PaginationItem key={p}>
						<PaginationLink isActive={p === page} onClick={() => onPage(p)}>
							{p + 1}
						</PaginationLink>
					</PaginationItem>
				))}
				<PaginationItem>
					<PaginationNext
						disabled={page === total - 1}
						onClick={() => onPage(page + 1)}
					/>
				</PaginationItem>
			</PaginationContent>
		</Pagination>
	);
}

export function CodesTable({ codes, onRevoke }: CodesTableProps) {
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(0);
	const [confirmingId, setConfirmingId] = useState<string | null>(null);

	const filtered = filterCodes(codes, query);
	const safePage = clampPage(page, filtered.length);
	const rows = pageOf(filtered, safePage);
	const total = pageCount(filtered.length);

	function handleQuery(q: string) {
		setQuery(q);
		setPage(0);
	}

	return (
		<div className="authz-enter">
			<CodesToolbar onQuery={handleQuery} query={query} />
			<div
				className="fade-in slide-in-from-right-2 flex animate-in flex-col gap-2 duration-200 sm:hidden"
				key={`cards-${safePage}`}
			>
				{rows.map((code) => (
					<CodeCard
						code={code}
						confirmingId={confirmingId}
						key={code.id}
						onConfirmRequest={setConfirmingId}
						onRevoke={onRevoke}
					/>
				))}
				{rows.length === 0 && (
					<p className="py-8 text-center text-muted-foreground text-sm">
						No codes found.
					</p>
				)}
			</div>
			<div className="hidden overflow-x-auto sm:block">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Code</TableHead>
							<TableHead>Label</TableHead>
							<TableHead>Source</TableHead>
							<TableHead>Used</TableHead>
							<TableHead />
						</TableRow>
					</TableHeader>
					<TableBody
						className="fade-in slide-in-from-right-2 animate-in duration-200"
						key={safePage}
					>
						{rows.map((code) => (
							<CodeRow
								code={code}
								confirmingId={confirmingId}
								key={code.id}
								onConfirmRequest={setConfirmingId}
								onRevoke={onRevoke}
							/>
						))}
						{rows.length === 0 && (
							<TableRow>
								<TableCell
									className="text-center text-muted-foreground"
									colSpan={5}
								>
									No codes found.
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			<CodesPagination onPage={setPage} page={safePage} total={total} />
		</div>
	);
}
