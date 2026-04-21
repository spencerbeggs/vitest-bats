import { defineConfig } from "vitest/config";
import { BatsPlugin } from "vitest-bats";

export default defineConfig({
	plugins: [BatsPlugin()],
	test: {
		include: ["__test__/**/*.test.ts"],
		testTimeout: 30000,
		coverage: {
			provider: "v8",
		},
	},
});
