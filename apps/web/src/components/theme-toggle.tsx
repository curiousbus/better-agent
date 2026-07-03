import { Button } from "@better-agent/ui/components/button";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { toggleTheme } from "@/utils/theme";

export function ThemeToggle() {
	const [isDark, setIsDark] = useState(false);

	useEffect(() => {
		setIsDark(document.documentElement.classList.contains("dark"));
	}, []);

	const handleClick = () => {
		setIsDark(toggleTheme() === "dark");
	};

	return (
		<Button
			aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
			className="shrink-0"
			onClick={handleClick}
			size="icon-sm"
			type="button"
			variant="ghost"
		>
			{isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
		</Button>
	);
}
