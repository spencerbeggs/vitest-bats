import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test, vi } from "vitest";
import { BatsCoverageReporter } from "../src/coverage-reporter.js";

const SCRIPT_CONTENT = [
	"#!/usr/bin/env bash",
	'echo "hello"',
	"# this is a comment",
	"",
	'if [ "$1" = "world" ]; then',
	"then",
	'  echo "world"',
	"fi",
].join("\n");

describe("BatsCoverageReporter", () => {
	const testDir = join(tmpdir(), `vitest-bats-test-${Date.now()}`);

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	test("onCoverage is a no-op when coverage is not an object", () => {
		const reporter = new BatsCoverageReporter(testDir);
		expect(() => reporter.onCoverage(null)).not.toThrow();
		expect(() => reporter.onCoverage(undefined)).not.toThrow();
		expect(() => reporter.onCoverage("string")).not.toThrow();
	});

	test("onCoverage is a no-op when coverageMap has no addFileCoverage", () => {
		const reporter = new BatsCoverageReporter(testDir);
		expect(() => reporter.onCoverage({})).not.toThrow();
	});

	test("onCoverage is a no-op when scripts.json does not exist", () => {
		const reporter = new BatsCoverageReporter(testDir);
		const added: unknown[] = [];
		const coverageMap = { addFileCoverage: (fc: unknown) => added.push(fc) };
		reporter.onCoverage(coverageMap);
		expect(added).toEqual([]);
	});

	test("onCoverage adds zero-coverage entries for scripts in manifest", () => {
		mkdirSync(testDir, { recursive: true });

		const scriptPath = join(testDir, "test-script.sh");
		writeFileSync(scriptPath, SCRIPT_CONTENT);
		writeFileSync(join(testDir, "scripts.json"), JSON.stringify([scriptPath]));

		const reporter = new BatsCoverageReporter(testDir);
		const added: Array<{ path: string; s: Record<string, number> }> = [];
		const coverageMap = {
			addFileCoverage: (fc: { path: string; s: Record<string, number> }) => added.push(fc),
		};
		reporter.onCoverage(coverageMap);

		expect(added).toHaveLength(1);
		expect(added[0].path).toBe(scriptPath);
		for (const hits of Object.values(added[0].s)) {
			expect(hits).toBe(0);
		}
	});
});

describe("BatsCoverageReporter synthetic pass-through", () => {
	const testDir = join(tmpdir(), `vitest-bats-synthetic-${Date.now()}`);
	const thresholds = { statements: 50, branches: 50, functions: 50, lines: 50 };

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	function setupManifest(scriptContent: string): string {
		mkdirSync(testDir, { recursive: true });
		const scriptPath = join(testDir, "synth.sh");
		writeFileSync(scriptPath, scriptContent);
		writeFileSync(join(testDir, "scripts.json"), JSON.stringify([scriptPath]));
		return scriptPath;
	}

	test("generates synthetic entries at threshold level when statementPassThrough is true", () => {
		const scriptPath = setupManifest(SCRIPT_CONTENT);
		const reporter = new BatsCoverageReporter(testDir, { thresholds, statementPassThrough: true });

		const added: Array<{
			path: string;
			s: Record<string, number>;
			b: Record<string, number[]>;
			f: Record<string, number>;
		}> = [];
		const coverageMap = { addFileCoverage: (fc: (typeof added)[0]) => added.push(fc) };

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		reporter.onCoverage(coverageMap);
		warnSpy.mockRestore();

		expect(added).toHaveLength(1);
		expect(added[0].path).toBe(scriptPath);

		// Statements should be exactly 50%
		const stmtValues = Object.values(added[0].s);
		const covered = stmtValues.filter((v) => v > 0).length;
		expect(covered / stmtValues.length).toBe(0.5);

		// Branches should be exactly 50%
		const branchArms = Object.values(added[0].b).flat();
		const coveredBranches = branchArms.filter((v) => v > 0).length;
		expect(coveredBranches / branchArms.length).toBe(0.5);

		// Functions should be exactly 50%
		const funcValues = Object.values(added[0].f);
		const coveredFuncs = funcValues.filter((v) => v > 0).length;
		expect(coveredFuncs / funcValues.length).toBe(0.5);
	});

	test("prints warning when pass-through is used", () => {
		setupManifest(SCRIPT_CONTENT);
		const reporter = new BatsCoverageReporter(testDir, { thresholds, statementPassThrough: true });

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			reporter.onCoverage({ addFileCoverage: () => {} });
			expect(warnSpy).toHaveBeenCalledOnce();
			const msg = warnSpy.mock.calls[0][0] as string;
			expect(msg).toContain("estimated");
			expect(msg).toContain("50%");
		} finally {
			warnSpy.mockRestore();
		}
	});

	test("prints mixed threshold description when thresholds differ", () => {
		setupManifest(SCRIPT_CONTENT);
		const mixed = { statements: 80, branches: 60, functions: 70, lines: 80 };
		const reporter = new BatsCoverageReporter(testDir, { thresholds: mixed, statementPassThrough: true });

		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		try {
			reporter.onCoverage({ addFileCoverage: () => {} });
			const msg = warnSpy.mock.calls[0][0] as string;
			expect(msg).toContain("S:80%");
			expect(msg).toContain("B:60%");
		} finally {
			warnSpy.mockRestore();
		}
	});

	test("handles 75% threshold with exact fraction", () => {
		setupManifest(SCRIPT_CONTENT);
		const t75 = { statements: 75, branches: 75, functions: 75, lines: 75 };
		const reporter = new BatsCoverageReporter(testDir, { thresholds: t75, statementPassThrough: true });

		const added: Array<{ s: Record<string, number>; b: Record<string, number[]>; f: Record<string, number> }> = [];
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		reporter.onCoverage({ addFileCoverage: (fc: (typeof added)[0]) => added.push(fc) });
		warnSpy.mockRestore();

		const stmtValues = Object.values(added[0].s);
		const covered = stmtValues.filter((v) => v > 0).length;
		expect(covered / stmtValues.length).toBe(0.75);

		const branchArms = Object.values(added[0].b).flat();
		expect(branchArms.filter((v) => v > 0).length / branchArms.length).toBe(0.75);

		const funcValues = Object.values(added[0].f);
		expect(funcValues.filter((v) => v > 0).length / funcValues.length).toBe(0.75);
	});

	test("does not synthesize when statementPassThrough is false", () => {
		setupManifest(SCRIPT_CONTENT);
		const reporter = new BatsCoverageReporter(testDir, { thresholds, statementPassThrough: false });

		const added: Array<{ s: Record<string, number> }> = [];
		reporter.onCoverage({ addFileCoverage: (fc: (typeof added)[0]) => added.push(fc) });

		// Should get zero-coverage (no pass-through)
		for (const hits of Object.values(added[0].s)) {
			expect(hits).toBe(0);
		}
	});
});

describe("BatsCoverageReporter kcov cobertura parsing", () => {
	const testDir = join(tmpdir(), `vitest-bats-cobertura-${Date.now()}`);
	const thresholds = { statements: 50, branches: 50, functions: 50, lines: 50 };

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	function writeCoberturaXml(testId: string, scriptName: string, lines: Array<{ num: number; hits: number }>): void {
		const scriptDir = join(testDir, "kcov", testId, scriptName);
		mkdirSync(scriptDir, { recursive: true });

		const lineElements = lines.map((l) => `<line number="${l.num}" hits="${l.hits}"/>`).join("\n");
		const xml = `<?xml version="1.0"?>
<coverage>
  <sources><source>/workspace/scripts</source></sources>
  <packages>
    <package>
      <classes>
        <class filename="${scriptName}">
          <lines>${lineElements}</lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>`;

		writeFileSync(join(scriptDir, "cobertura.xml"), xml);
	}

	test("parses cobertura.xml and maps to Istanbul format", () => {
		mkdirSync(testDir, { recursive: true });
		const scriptPath = `/workspace/scripts/parsed.sh`;
		writeFileSync(join(testDir, "scripts.json"), JSON.stringify([scriptPath]));

		writeCoberturaXml("test-1", "parsed.sh", [
			{ num: 2, hits: 5 },
			{ num: 3, hits: 0 },
			{ num: 4, hits: 3 },
		]);

		const reporter = new BatsCoverageReporter(testDir);
		const added: Array<{
			path: string;
			s: Record<string, number>;
			statementMap: Record<string, { start: { line: number } }>;
		}> = [];
		reporter.onCoverage({ addFileCoverage: (fc: (typeof added)[0]) => added.push(fc) });

		expect(added).toHaveLength(1);
		expect(added[0].path).toBe(scriptPath);
		expect(Object.values(added[0].s)).toEqual([5, 0, 3]);
		expect(added[0].statementMap["0"].start.line).toBe(2);
		expect(added[0].statementMap["1"].start.line).toBe(3);
		expect(added[0].statementMap["2"].start.line).toBe(4);
	});

	test("merges multiple cobertura files for the same script", () => {
		mkdirSync(testDir, { recursive: true });
		const scriptPath = `/workspace/scripts/merged.sh`;
		writeFileSync(join(testDir, "scripts.json"), JSON.stringify([scriptPath]));

		// First test run: lines 2 and 3 hit
		writeCoberturaXml("merge-1", "merged.sh", [
			{ num: 2, hits: 1 },
			{ num: 3, hits: 1 },
			{ num: 4, hits: 0 },
		]);

		// Second test run: line 4 hit, line 2 hit more
		writeCoberturaXml("merge-2", "merged.sh", [
			{ num: 2, hits: 3 },
			{ num: 3, hits: 0 },
			{ num: 4, hits: 2 },
		]);

		const reporter = new BatsCoverageReporter(testDir);
		const added: Array<{ path: string; s: Record<string, number> }> = [];
		reporter.onCoverage({ addFileCoverage: (fc: (typeof added)[0]) => added.push(fc) });

		expect(added).toHaveLength(1);
		// Should take max of each statement: [max(1,3), max(1,0), max(0,2)] = [3, 1, 2]
		expect(Object.values(added[0].s)).toEqual([3, 1, 2]);
	});

	test("applies synthetic branches/functions to real kcov data when thresholds set", () => {
		mkdirSync(testDir, { recursive: true });
		const scriptPath = `/workspace/scripts/kcov-synth.sh`;
		writeFileSync(join(testDir, "scripts.json"), JSON.stringify([scriptPath]));

		writeCoberturaXml("synth-1", "kcov-synth.sh", [
			{ num: 2, hits: 1 },
			{ num: 3, hits: 0 },
		]);

		const reporter = new BatsCoverageReporter(testDir, { thresholds });
		const added: Array<{
			path: string;
			s: Record<string, number>;
			b: Record<string, number[]>;
			f: Record<string, number>;
		}> = [];
		reporter.onCoverage({ addFileCoverage: (fc: (typeof added)[0]) => added.push(fc) });

		expect(added).toHaveLength(1);

		// Statements should be real kcov data
		expect(Object.values(added[0].s)).toEqual([1, 0]);

		// Branches should be synthetic at 50%
		const branchArms = Object.values(added[0].b).flat();
		expect(branchArms.filter((v) => v > 0).length / branchArms.length).toBe(0.5);

		// Functions should be synthetic at 50%
		const funcValues = Object.values(added[0].f);
		expect(funcValues.filter((v) => v > 0).length / funcValues.length).toBe(0.5);
	});
});

describe("BatsCoverageReporter isExecutableLine", () => {
	const testDir = join(tmpdir(), `vitest-bats-exec-${Date.now()}`);

	afterAll(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	test("excludes comments, structural keywords, and blank lines", () => {
		mkdirSync(testDir, { recursive: true });
		const scriptPath = join(testDir, "exec-test.sh");
		writeFileSync(
			scriptPath,
			[
				"#!/usr/bin/env bash",
				"# comment",
				"",
				'echo "executable"',
				"then",
				"else",
				"fi",
				"do",
				"done",
				"esac",
				";;",
				"{",
				"}",
				'NAME="World"',
			].join("\n"),
		);
		writeFileSync(join(testDir, "scripts.json"), JSON.stringify([scriptPath]));

		const reporter = new BatsCoverageReporter(testDir);
		const added: Array<{ s: Record<string, number>; statementMap: Record<string, { start: { line: number } }> }> = [];
		reporter.onCoverage({ addFileCoverage: (fc: (typeof added)[0]) => added.push(fc) });

		expect(added).toHaveLength(1);
		// Only 'echo "executable"' (line 4) and 'NAME="World"' (line 14) should be counted
		const lines = Object.values(added[0].statementMap).map((m) => m.start.line);
		expect(lines).toEqual([4, 14]);
	});
});
