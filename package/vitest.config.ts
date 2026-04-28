import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		root: import.meta.dirname,
		include: ["__test__/**/*.test.ts"],
		exclude: ["__test__/e2e/**", "__test__/integration/**"],
		testTimeout: 10000,
	},
});
