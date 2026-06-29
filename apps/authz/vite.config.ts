import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
	root: "app",
	plugins: [
		tanstackRouter({
			target: "react",
			routesDirectory: "routes",
			generatedRouteTree: "routeTree.gen.ts",
			autoCodeSplitting: true,
		}),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": new URL("./app", import.meta.url).pathname,
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
	},
});
