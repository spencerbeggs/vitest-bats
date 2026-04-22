import { execSync } from "node:child_process";

export function setup() {
	execSync("pnpm turbo run build:dev --log-prefix=none --output-logs=errors-only", { stdio: "inherit" });
}
