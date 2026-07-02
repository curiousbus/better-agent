import { PlugIcon } from "lucide-react";
import type { ReactNode } from "react";

export function IntegrationsEmptyState({
	title,
	description,
	action,
}: {
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center text-muted-foreground">
			<PlugIcon className="h-10 w-10 opacity-40" />
			<p className="font-medium text-base text-foreground">{title}</p>
			<p className="max-w-xs text-sm">{description}</p>
			{action}
		</div>
	);
}
