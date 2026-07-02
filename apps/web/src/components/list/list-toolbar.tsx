import { Input } from "@better-agent/ui/components/input";
import type { ReactNode } from "react";

export function ListToolbar({
	search,
	onSearch,
	placeholder,
	action,
}: {
	search: string;
	onSearch: (value: string) => void;
	placeholder: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-2">
			<Input
				aria-label="Search"
				className="max-w-xs"
				onChange={(event) => onSearch(event.target.value)}
				placeholder={placeholder}
				value={search}
			/>
			{action}
		</div>
	);
}
