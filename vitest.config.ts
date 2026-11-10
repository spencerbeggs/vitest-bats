import { defineConfig } from "vitest/config";
// The config loads in plain Node, which cannot run package/src, so it takes the
// built plugin. The test scripts run `turbo run build` before vitest.
import { BatsPlugin } from "./package/dist/prod/npm/pkg/index.js";

export default defineConfig({
	plugins: [BatsPlugin({ deps: "warn" })],
	test: {
		include: ["__test__/**/*.test.ts", "package/__test__/**/*.test.ts"],
		globalSetup: ["vitest.setup.ts"],
		testTimeout: 30000,
		coverage: {
			enabled: true,
			provider: "v8",
			include: ["package/src/**/*.ts"],
			exclude: [
				"package/src/shims.d.ts",
				"package/src/vitest-kcov-types.ts",
				"package/src/index.ts",
				"package/src/plugin.ts",
				"package/src/setup.ts",
			],
			thresholds: {
				statements: 50,
				branches: 50,
				functions: 50,
				lines: 50,
			},
		},
	},
});
