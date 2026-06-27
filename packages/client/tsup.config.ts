import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	// The .d.ts is produced separately by dts-bundle-generator (see the build
	// script), which compiles from source and inlines the @better-agent/agent
	// domain types so the published SDK needs no @better-agent/* packages.
	dts: false,
	clean: true,
	treeshake: true,
	sourcemap: true,
});
