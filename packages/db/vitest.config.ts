import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
		// Each integration test's beforeEach spins a fresh PGlite (WASM) and runs
		// the full migration chain (~1-2s alone). Running the suites in parallel
		// storms the CPU and pushes that setup past the default 10s hook timeout,
		// so run the files serially with a generous hook timeout for reliability
		// (locally and on the 2-core CI runner).
		hookTimeout: 60_000,
		testTimeout: 30_000,
		fileParallelism: false,
	},
});
