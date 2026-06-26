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
	plugins: [
		tailwindcss(),
		// SPA mode: prerender a static shell and let the client do all data
		// fetching. The frontends run as their own Cloudflare Worker and cannot
		// reach the API Worker via a server-to-server fetch during SSR, so we
		// avoid SSR data loading entirely.
		tanstackStart({ spa: { enabled: true } }),
		nitro(),
		viteReact(),
	],
});
