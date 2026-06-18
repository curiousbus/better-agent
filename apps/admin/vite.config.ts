import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
	server: {
		port: 3002,
	},
	resolve: {
		tsconfigPaths: true,
	},
	build: {
		rolldownOptions: {
			// shiki uses WASM which cannot be bundled for SSR; code-block is
			// client-only, so exclude shiki from the server bundle.
			external: ["shiki"],
		},
	},
	plugins: [tailwindcss(), tanstackStart(), nitro(), viteReact()],
});
