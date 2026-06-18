import { cn } from "@better-agent/ui/lib/utils";

export function Loader({ className }: { className?: string }) {
	return (
		<span className={cn("inline-flex gap-1", className)}>
			<span
				className="size-1.5 animate-bounce rounded-full bg-current"
				style={{ animationDelay: "-0.3s" }}
			/>
			<span
				className="size-1.5 animate-bounce rounded-full bg-current"
				style={{ animationDelay: "-0.15s" }}
			/>
			<span className="size-1.5 animate-bounce rounded-full bg-current" />
		</span>
	);
}
