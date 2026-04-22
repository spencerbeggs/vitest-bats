import { execSync } from "node:child_process";
import { chmodSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { TestRunner } from "vitest";
import type { BatsDeps, KcovConfig } from "./bats-generator.js";
import { generateBatsFile } from "./bats-generator.js";
import { findActive, resetAll } from "./runtime.js";

export default class BatsRunner extends TestRunner {
	private tempDir: string;
	private deps: BatsDeps;
	private kcov: KcovConfig | undefined;
	private kcovCacheDir: string | null;

	constructor(config: ConstructorParameters<typeof TestRunner>[0]) {
		super(config);

		this.tempDir = join(tmpdir(), `vitest-bats-${process.pid}`);
		mkdirSync(this.tempDir, { recursive: true });

		this.deps = {
			batsPath: process.env.BATS_PATH ?? "bats",
			batsSupportPath: process.env.BATS_SUPPORT_PATH ?? "",
			batsAssertPath: process.env.BATS_ASSERT_PATH ?? "",
			batsMockPath: process.env.BATS_MOCK_PATH ?? "",
		};

		this.kcovCacheDir = process.env.__VITEST_BATS_CACHE_DIR__ ?? null;

		if (process.env.__VITEST_BATS_KCOV__ === "1" && process.env.KCOV_PATH) {
			this.kcov = {
				kcovPath: process.env.KCOV_PATH,
				outputDir: "",
			};
		}
	}

	override async onBeforeRunTask(test: Parameters<NonNullable<TestRunner["onBeforeRunTask"]>>[0]): Promise<void> {
		resetAll();
		return super.onBeforeRunTask(test);
	}

	override onAfterTryTask(test: Parameters<NonNullable<TestRunner["onAfterTryTask"]>>[0]): void {
		const active = findActive();
		if (active?.fromTransform) {
			const commands = [...active.commands];
			active.reset();

			// Build per-test kcov config with unique output dir
			let kcovForTest: KcovConfig | undefined;
			if (this.kcov && this.kcovCacheDir) {
				const scriptName = basename(active.path, ".sh");
				const testId = `${scriptName}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				const outputDir = resolve(this.kcovCacheDir, "kcov", testId);
				mkdirSync(outputDir, { recursive: true });
				kcovForTest = { kcovPath: this.kcov.kcovPath, outputDir };
			}

			// Ensure the script is executable
			const scriptStat = statSync(active.path);
			if (!(scriptStat.mode & 0o111)) {
				chmodSync(active.path, scriptStat.mode | 0o755);
			}

			const batsContent = generateBatsFile(active.path, test.name, commands, this.deps, kcovForTest);

			const batsFile = resolve(this.tempDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.bats`);
			writeFileSync(batsFile, batsContent, { mode: 0o755 });

			try {
				execSync(`bats --tap "${batsFile}"`, {
					encoding: "utf-8",
					stdio: ["pipe", "pipe", "pipe"],
					timeout: 60000,
				});
			} catch (error) {
				const err = error as { stdout?: string; stderr?: string; message?: string };
				const output = err.stdout ?? err.stderr ?? err.message ?? "Unknown BATS error";
				throw new Error(`BATS test failed:\n${output}`);
			}
		}

		super.onAfterTryTask(test);
	}
}
