import { NodeLibraryBuilder } from "@savvy-web/rslib-builder";

const baseConfig = NodeLibraryBuilder.create({
	externals: ["vitest", "child_process", "fs", "path"],
	bundle: true,
	apiModel: {
		suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
	},
	transform({ pkg, target }) {
		if (target?.registry === "https://npm.pkg.github.com/") {
			pkg.name = "@spencerbeggs/vitest-bats";
		}
		delete pkg.devDependencies;
		delete pkg.bundleDependencies;
		delete pkg.scripts;
		delete pkg.publishConfig;
		delete pkg.packageManager;
		delete pkg.devEngines;
		return pkg;
	},
});

// WORKAROUND for savvy-web/rslib-builder#158:
// Override library.type from 'modern-module' to plain 'module' so each entry
// is self-contained valid ESM (no shared chunks importing/redeclaring
// __webpack_require__). Trade-off: shared classes (e.g., BatsResult) get
// duplicated across entry bundles, breaking instanceof across entries —
// matchers.ts uses duck typing as a result.
// biome-ignore lint/suspicious/noExplicitAny: rslib config function shape varies
export default async (env: any, ctx: any) => {
	// biome-ignore lint/suspicious/noExplicitAny: rslib config function shape varies
	const config = await (baseConfig as any)(env, ctx);
	for (const lib of config.lib ?? []) {
		const existingTools = lib.tools ?? {};
		const existingRspack = existingTools.rspack;
		lib.tools = {
			...existingTools,
			// biome-ignore lint/suspicious/noExplicitAny: rspack config shape
			rspack: (rspackConfig: any, utils: any) => {
				if (typeof existingRspack === "function") {
					existingRspack(rspackConfig, utils);
				}
				rspackConfig.output ??= {};
				rspackConfig.output.library = { type: "module" };
				return rspackConfig;
			},
		};
	}
	return config;
};
