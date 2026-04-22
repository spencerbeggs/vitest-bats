declare module "*.sh" {
	import type { ScriptBuilder } from "vitest-bats/runtime";
	const script: ScriptBuilder;
	export default script;
}
