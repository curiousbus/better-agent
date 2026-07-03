export type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "theme";
const DARK_CLASS = "dark";

export function getStoredTheme(): Theme | null {
	if (typeof window === "undefined") {
		return null;
	}
	const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
	return stored === "light" || stored === "dark" ? stored : null;
}

function getSystemTheme(): Theme {
	const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	return prefersDark ? "dark" : "light";
}

export function applyTheme(theme: Theme): void {
	document.documentElement.classList.toggle(DARK_CLASS, theme === "dark");
}

/** FOUC-free init: applies the stored theme, falling back to system preference. */
export function initTheme(): void {
	if (typeof document === "undefined") {
		return;
	}
	applyTheme(getStoredTheme() ?? getSystemTheme());
}

/** Flips the current theme, persists it, and applies it. Returns the new theme. */
export function toggleTheme(): Theme {
	const isDark = document.documentElement.classList.contains(DARK_CLASS);
	const next: Theme = isDark ? "light" : "dark";
	window.localStorage.setItem(THEME_STORAGE_KEY, next);
	applyTheme(next);
	return next;
}
