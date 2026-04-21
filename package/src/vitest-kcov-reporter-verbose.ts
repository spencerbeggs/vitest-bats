/**
 * Custom Vitest reporter for verbose test output with hyperlinks.
 *
 * @remarks
 * Provides verbose test output with:
 * - Shortened file paths (relative to test directory)
 * - OSC 8 hyperlinks for test files and script names (when enabled)
 * - Clickable links to VSCode for easy navigation
 *
 * @packageDocumentation
 */

import { basename } from "node:path";
import type { Vitest } from "vitest/node";
import { DefaultReporter } from "vitest/node";
import { HTELink } from "./hte-link.js";

// Vitest internal types - using any since they're not properly exported
// biome-ignore lint/suspicious/noExplicitAny: Vitest internal types not exported
type TestCase = any;
// biome-ignore lint/suspicious/noExplicitAny: Vitest internal types not exported
type TestModule = any;

/**
 * Options for the kcov verbose reporter.
 */
interface KcovVerboseReporterOptions {
	/** Enable debug logging */
	debug?: boolean;
}

/**
 * Custom kcov verbose reporter with hyperlink support.
 *
 * @remarks
 * Shows individual test results with shortened paths and optional
 * OSC 8 hyperlinks when `links: "hte"` is configured.
 */
export default class KcovVerboseReporter extends DefaultReporter {
	protected verbose = true;
	renderSucceed = true;

	private linker!: HTELink;
	private projectRoot: string = process.cwd();
	private debug: boolean;

	constructor(options: KcovVerboseReporterOptions = {}) {
		super();
		this.debug = options.debug ?? false;
	}

	/**
	 * Initialize the reporter with Vitest context.
	 */
	override async onInit(ctx: Vitest): Promise<void> {
		await super.onInit(ctx);

		this.projectRoot = ctx.config.root || process.cwd();

		// Get configuration from kcov options
		// Cast to unknown first, then access kcov properties (custom extension via vitest-kcov-types.ts)
		const coverage = ctx.config.coverage as unknown as { kcov?: { links?: string } } | undefined;
		const linksMode = (coverage?.kcov?.links as "auto" | "default" | "hte" | undefined) || "auto";
		this.linker = new HTELink({ mode: linksMode, debug: this.debug });

		// Debug
		if (this.debug) {
			console.log("\n🔍 KcovVerboseReporter initialized:");
			console.log(`   Links mode: ${linksMode}`);
			console.log("   Script paths: Read from suite metadata");
		}
	}

	/**
	 * Override to prevent printing test module summary.
	 */
	override printTestModule(_module: TestModule): void {
		// Don't print test module, only print individual tests
	}

	/**
	 * Called when a test case completes.
	 */
	override onTestCaseResult(test: TestCase): void {
		super.onTestCaseResult(test);

		const testResult = test.result();

		// Skip if hideSkippedTests is enabled and test was skipped
		if (this.ctx.config.hideSkippedTests && testResult.state === "skipped") {
			return;
		}

		// Debug output
		if (this.debug) {
			console.log(`\n🧪 Test case: ${test.module.task.name} > ${this.buildTestName(test.task)}`);
		}

		// Build title with icon, file path, and test name
		const icon = this.getIcon(testResult.state);

		// Get absolute path for VSCode link, shortened display name
		const absolutePath = test.module.task.file?.filepath || test.module.task.name;
		const filePath = this.getShortenedPath(absolutePath);
		const fileLink = this.linker.create(`vscode://file${absolutePath}`, filePath);

		// Get test name (includes suite hierarchy)
		const testName = this.buildTestName(test.task);

		// Add clickable links to script names in test name
		const testNameWithLinks = this.addScriptLinks(testName, test.task);

		// Format duration with color based on test state
		// Duration is on test.task.result, not testResult
		const durationMs = test.task.result?.duration;
		const duration = durationMs ? this.formatDuration(durationMs, testResult.state) : "";

		// Output: icon filepath > testname duration
		process.stdout.write(`${icon} ${fileLink} > ${testNameWithLinks}${duration}\n`);

		// Show errors if test failed
		if (testResult.state === "failed" && testResult.errors) {
			for (const error of testResult.errors) {
				const message = error.message || String(error);
				process.stdout.write(`   \u001b[31m→ ${message}\u001b[0m\n`);
			}
		}
	}

	/**
	 * Get test name from task, including suite hierarchy.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: Vitest internal types not exported
	private buildTestName(task: any, separator = " > "): string {
		const parts: string[] = [];
		let current = task;

		// Walk up the task tree collecting names
		while (current) {
			if (current.name && current.type !== "file") {
				parts.unshift(current.name);
			}
			current = current.suite;
		}

		return parts.join(separator);
	}

	/**
	 * Get script path from test suite metadata.
	 *
	 * @remarks
	 * BatsHelper.describe() stores the script path in suite metadata,
	 * which we can access here without circular dependencies.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: Vitest internal types not exported
	private getScriptPath(task: any): string | null {
		// Walk up the suite hierarchy looking for scriptPath in meta
		let current = task;
		while (current) {
			if (current.meta?.scriptPath) {
				return current.meta.scriptPath;
			}
			current = current.suite;
		}
		return null;
	}

	/**
	 * Add hyperlinks to script names in test name.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: Vitest internal types not exported
	private addScriptLinks(testName: string, task: any): string {
		// Get script path from suite metadata
		const scriptPath = this.getScriptPath(task);

		if (!scriptPath) {
			return testName;
		}

		// Convert file:// URL to path if needed
		let path = scriptPath;
		if (scriptPath.startsWith("file://")) {
			path = new URL(scriptPath).pathname;
		}

		const parts = testName.split(" > ");
		const linkedParts = parts.map((part) => {
			// Check if this part is a shell script (ends with .sh)
			if (part.endsWith(".sh")) {
				// Create link using the script path from metadata
				return this.linker.create(`vscode://file${path}`, part);
			}
			return part;
		});
		return linkedParts.join(" > ");
	}

	/**
	 * Get icon for test state.
	 */
	private getIcon(state: string): string {
		switch (state) {
			case "pass":
			case "passed":
				return "\u001b[32m✓\u001b[0m"; // Green checkmark
			case "fail":
			case "failed":
				return "\u001b[31m✖\u001b[0m"; // Red X
			case "skip":
			case "skipped":
				return "\u001b[33m⊝\u001b[0m"; // Yellow skip
			case "todo":
				return "\u001b[36m◯\u001b[0m"; // Cyan todo
			default:
				return "→";
		}
	}

	/**
	 * Format duration with color based on test state.
	 */
	private formatDuration(duration: number, state: string): string {
		// Round to 2 decimal places for readability
		const rounded = Math.round(duration * 100) / 100;
		const durationText = ` ${rounded}ms`;

		// Color based on test state
		switch (state) {
			case "pass":
			case "passed":
				return `\u001b[32m${durationText}\u001b[0m`; // Green
			case "fail":
			case "failed":
				return `\u001b[31m${durationText}\u001b[0m`; // Red
			case "skip":
			case "skipped":
				return `\u001b[33m${durationText}\u001b[0m`; // Yellow
			default:
				return `\u001b[90m${durationText}\u001b[0m`; // Gray
		}
	}

	/**
	 * Get shortened file path (just the basename).
	 */
	private getShortenedPath(filepath: string): string {
		return basename(filepath);
	}
}
