// apps/web/src/components/dashboard/window-toggle.tsx

import { WINDOW_OPTIONS, type WindowDays } from "./dashboard-constants";

interface WindowToggleProps {
	onChange: (w: WindowDays) => void;
	value: WindowDays;
}

const WINDOW_LABELS: Record<WindowDays, string> = {
	3: "3D",
	7: "7D",
	12: "12D",
};

export function WindowToggle({ onChange, value }: WindowToggleProps) {
	return (
		<div className="flex items-center gap-1 rounded-lg border bg-muted p-1">
			{WINDOW_OPTIONS.map((w) => (
				<button
					className={[
						"rounded-md px-3 py-1 font-medium text-sm transition-colors",
						value === w
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					].join(" ")}
					key={w}
					onClick={() => onChange(w)}
					type="button"
				>
					{WINDOW_LABELS[w]}
				</button>
			))}
		</div>
	);
}
