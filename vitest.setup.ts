import { execSync } from "node:child_process";

export function setup() {
	try {
		execSync("pnpm turbo run build:dev --log-prefix=none --output-logs=errors-only", { stdio: "pipe" });
	} catch (error) {
		const execError = error as { stderr?: Buffer; stdout?: Buffer };
		if (execError.stderr?.length) {
			process.stderr.write(execError.stderr);
		}
		if (execError.stdout?.length) {
			process.stdout.write(execError.stdout);
		}
		throw error;
	}
}
