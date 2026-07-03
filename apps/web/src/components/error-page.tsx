import { Button } from "@better-agent/ui/components/button";
import { CloudAlert } from "lucide-react";

const reloadPage = () => {
	window.location.reload();
};

const goHome = () => {
	window.location.href = "/dashboard";
};

/**
 * Generic full-height error state shown by the router's error boundary. No
 * raw error text on screen — the actual error is logged to the console by
 * the caller.
 */
export function ErrorPage() {
	return (
		<div className="flex h-full flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
			<CloudAlert className="size-10 text-muted-foreground" />
			<div className="flex flex-col gap-1">
				<p className="font-medium text-base">Something went wrong</p>
				<p className="text-muted-foreground text-sm">
					The error has been logged to the console.
				</p>
			</div>
			<div className="flex items-center gap-2">
				<Button onClick={reloadPage} type="button" variant="outline">
					Reload
				</Button>
				<Button onClick={goHome} type="button">
					Back to home
				</Button>
			</div>
		</div>
	);
}
