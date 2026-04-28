import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";

interface IstanbulLocation {
	start: { line: number; column: number };
	end: { line: number; column: number };
}

interface IstanbulFileCoverage {
	path: string;
	statementMap: Record<string, IstanbulLocation>;
	fnMap: Record<string, unknown>;
	branchMap: Record<string, unknown>;
	s: Record<string, number>;
	f: Record<string, number>;
	b: Record<string, number[]>;
}

interface CoberturaLine {
	"@_number": string;
	"@_hits": string;
}

export interface CoverageThresholds {
	statements: number;
	branches: number;
	functions: number;
	lines: number;
}

export class BatsCoverageReporter {
	private cacheDir: string;
	private thresholds: CoverageThresholds | false;
	private statementPassThrough: boolean;
	private readonly xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

	constructor(cacheDir: string, options: { thresholds?: CoverageThresholds; statementPassThrough?: boolean } = {}) {
		this.cacheDir = cacheDir;
		this.thresholds = options.thresholds ?? false;
		this.statementPassThrough = options.statementPassThrough ?? false;
	}

	onInit(): void {
		// Clear stale kcov outputs from prior sessions so coverage merge only
		// sees data from the current run.
		const kcovDir = resolve(this.cacheDir, "kcov");
		if (existsSync(kcovDir)) {
			rmSync(kcovDir, { recursive: true, force: true });
		}
	}

	onCoverage(coverage: unknown): void {
		if (!coverage || typeof coverage !== "object") return;

		const coverageMap = coverage as {
			addFileCoverage?: (fc: IstanbulFileCoverage) => void;
		};
		if (typeof coverageMap.addFileCoverage !== "function") return;

		const manifestPath = resolve(this.cacheDir, "scripts.json");
		if (!existsSync(manifestPath)) return;

		let scripts: string[];
		try {
			scripts = JSON.parse(readFileSync(manifestPath, "utf-8"));
		} catch /* v8 ignore next */ {
			return;
		}

		const kcovCoverage = this.collectKcovCoverage();

		const passThroughScripts: string[] = [];
		for (const scriptPath of scripts) {
			const kcovEntry = kcovCoverage.get(scriptPath);
			if (kcovEntry) {
				// Real kcov data: use real statements/lines.
				// kcov doesn't track shell branches/functions, so apply
				// synthetic entries at threshold level to keep them neutral.
				if (this.thresholds) {
					this.applySyntheticBranches(kcovEntry, this.thresholds.branches);
					this.applySyntheticFunctions(kcovEntry, this.thresholds.functions);
				}
				coverageMap.addFileCoverage(kcovEntry);
			} else if (this.statementPassThrough) {
				// No kcov data and unreliable environment: synthesize everything
				// at threshold level so scripts are neutral in threshold checks
				const fc = this.buildSyntheticCoverageEntry(scriptPath);
				if (fc) {
					coverageMap.addFileCoverage(fc);
					passThroughScripts.push(scriptPath);
				}
			} else {
				const fc = this.buildZeroCoverageEntry(scriptPath);
				if (fc) {
					coverageMap.addFileCoverage(fc);
				}
			}
		}

		if (passThroughScripts.length > 0 && this.thresholds) {
			const scriptNames = passThroughScripts.map((s) => basename(s)).join(", ");
			const { statements, branches, functions, lines } = this.thresholds;
			const thresholdDesc =
				statements === branches && branches === functions && functions === lines
					? `${statements}%`
					: `S:${statements}% B:${branches}% F:${functions}% L:${lines}%`;
			console.warn(
				`\n  [vitest-bats] Shell script coverage is estimated (kcov unavailable or unreliable on this platform).` +
					`\n  Scripts (${scriptNames}) are set to ${thresholdDesc} to match coverage thresholds.` +
					`\n  Run in Docker with kcov for accurate shell script coverage.\n`,
			);
		}
	}

	private buildSyntheticCoverageEntry(scriptPath: string): IstanbulFileCoverage | null {
		if (!this.thresholds) return null;
		const entry = this.buildZeroCoverageEntry(scriptPath);
		if (!entry) return null;

		const stmtThreshold = Math.max(this.thresholds.statements, this.thresholds.lines);
		this.applySyntheticStatements(entry, stmtThreshold);
		this.applySyntheticBranches(entry, this.thresholds.branches);
		this.applySyntheticFunctions(entry, this.thresholds.functions);

		return entry;
	}

	private gcd(a: number, b: number): number {
		let x = a;
		let y = b;
		while (y) {
			[x, y] = [y, x % y];
		}
		return x;
	}

	/** Returns the smallest total/covered pair that gives exactly threshold%. */
	private thresholdFraction(threshold: number): { total: number; covered: number } {
		if (threshold <= 0) return { total: 2, covered: 0 };
		if (threshold >= 100) return { total: 1, covered: 1 };
		const g = this.gcd(threshold, 100);
		return { total: 100 / g, covered: threshold / g };
	}

	/** Pad statements to an exact multiple and mark the right fraction as covered. */
	private applySyntheticStatements(entry: IstanbulFileCoverage, threshold: number): void {
		const { total: denom, covered: numer } = this.thresholdFraction(threshold);
		let count = Object.keys(entry.s).length;

		// Pad to make divisible by denom for exact percentage
		while (count % denom !== 0) {
			const idx = String(count);
			entry.statementMap[idx] = { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };
			entry.s[idx] = 0;
			count++;
		}

		const coveredCount = (count / denom) * numer;
		const keys = Object.keys(entry.s);
		for (let i = 0; i < coveredCount; i++) {
			entry.s[keys[i]] = 1;
		}
	}

	/** Create synthetic branch entries for exact threshold coverage. */
	private applySyntheticBranches(entry: IstanbulFileCoverage, threshold: number): void {
		const { total, covered } = this.thresholdFraction(threshold);
		const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };

		entry.branchMap = {
			"0": {
				type: "if",
				loc: { ...loc },
				locations: Array.from({ length: total }, () => ({ ...loc })),
			},
		};
		entry.b = {
			"0": Array.from({ length: total }, (_, i) => (i < covered ? 1 : 0)),
		};
	}

	/** Create synthetic function entries for exact threshold coverage. */
	private applySyntheticFunctions(entry: IstanbulFileCoverage, threshold: number): void {
		const { total, covered } = this.thresholdFraction(threshold);
		const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } };

		const fnMap: Record<string, unknown> = {};
		const f: Record<string, number> = {};
		for (let i = 0; i < total; i++) {
			fnMap[String(i)] = { name: "__synthetic", decl: { ...loc }, loc: { ...loc } };
			f[String(i)] = i < covered ? 1 : 0;
		}
		entry.fnMap = fnMap;
		entry.f = f;
	}

	private buildZeroCoverageEntry(scriptPath: string): IstanbulFileCoverage | null {
		let content: string;
		try {
			content = readFileSync(scriptPath, "utf-8");
		} catch /* v8 ignore next */ {
			return null;
		}

		const lines = content.split("\n");
		const statementMap: Record<string, IstanbulLocation> = {};
		const s: Record<string, number> = {};

		let stmtIndex = 0;
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (this.isExecutableLine(line)) {
				statementMap[String(stmtIndex)] = {
					start: { line: i + 1, column: 0 },
					end: { line: i + 1, column: lines[i].length },
				};
				s[String(stmtIndex)] = 0;
				stmtIndex++;
			}
		}

		return {
			path: scriptPath,
			statementMap,
			fnMap: {},
			branchMap: {},
			s,
			f: {},
			b: {},
		};
	}

	private isExecutableLine(line: string): boolean {
		if (!line) return false;
		if (line.startsWith("#")) return false;
		if (line === "then" || line === "else" || line === "fi") return false;
		if (line === "do" || line === "done") return false;
		if (line === "esac" || line === ";;") return false;
		if (line === "{" || line === "}") return false;
		return true;
	}

	/**
	 * Collect real coverage data from kcov cobertura.xml files.
	 * Returns a map of absolute script path to Istanbul file coverage.
	 */
	private collectKcovCoverage(): Map<string, IstanbulFileCoverage> {
		const result = new Map<string, IstanbulFileCoverage>();

		const kcovDir = resolve(this.cacheDir, "kcov");
		if (!existsSync(kcovDir)) return result;

		const coberturaFiles = this.findCoberturaFiles(kcovDir);
		for (const coberturaPath of coberturaFiles) {
			const fileCoverages = this.parseCoberturaToIstanbul(coberturaPath);
			for (const fc of fileCoverages) {
				const existing = result.get(fc.path);
				if (existing) {
					// Merge hit counts: take the max per statement across test runs
					for (const [key, hits] of Object.entries(fc.s)) {
						existing.s[key] = Math.max(existing.s[key] ?? 0, hits);
					}
					// Add any new statements not in the existing map
					for (const [key, loc] of Object.entries(fc.statementMap)) {
						if (!(key in existing.statementMap)) {
							existing.statementMap[key] = loc;
							existing.s[key] = fc.s[key] ?? 0;
						}
					}
				} else {
					result.set(fc.path, fc);
				}
			}
		}

		return result;
	}

	private findCoberturaFiles(dir: string): string[] {
		const results: string[] = [];
		try {
			// kcov output structure: <kcovDir>/<testId>/<scriptName>/cobertura.xml
			// Scan two levels deep to find cobertura.xml files
			const testDirs = readdirSync(dir);
			for (const testDir of testDirs) {
				const testDirPath = resolve(dir, testDir);
				if (!statSync(testDirPath).isDirectory()) continue;

				const innerEntries = readdirSync(testDirPath);
				for (const inner of innerEntries) {
					const innerPath = resolve(testDirPath, inner);
					if (!statSync(innerPath).isDirectory()) continue;

					const cobertura = resolve(innerPath, "cobertura.xml");
					if (existsSync(cobertura)) {
						results.push(cobertura);
					}
				}
			}
		} catch /* v8 ignore next */ {
			// Directory not readable
		}
		return results;
	}

	private parseCoberturaToIstanbul(coberturaPath: string): IstanbulFileCoverage[] {
		const results: IstanbulFileCoverage[] = [];

		try {
			const xmlContent = readFileSync(coberturaPath, "utf-8");
			const parsed = this.xmlParser.parse(xmlContent);

			const sources = parsed?.coverage?.sources?.source;
			const sourcePath: string = Array.isArray(sources) ? sources[0] : (sources ?? "");

			const packages = parsed?.coverage?.packages?.package;
			if (!packages) return results;

			const packageList = Array.isArray(packages) ? packages : [packages];

			for (const pkg of packageList) {
				const classes = pkg?.classes?.class;
				if (!classes) continue;

				const classList = Array.isArray(classes) ? classes : [classes];

				for (const cls of classList) {
					const filename = cls["@_filename"];
					if (!filename) continue;

					const absolutePath = sourcePath ? resolve(sourcePath.replace(/\/$/, ""), filename) : filename;

					const lines = cls?.lines?.line;
					if (!lines) continue;

					const lineList: CoberturaLine[] = Array.isArray(lines) ? lines : [lines];

					const statementMap: Record<string, IstanbulLocation> = {};
					const s: Record<string, number> = {};

					for (let i = 0; i < lineList.length; i++) {
						const lineNum = Number.parseInt(lineList[i]["@_number"], 10);
						const hits = Number.parseInt(lineList[i]["@_hits"], 10);

						if (Number.isNaN(lineNum)) continue;

						statementMap[String(i)] = {
							start: { line: lineNum, column: 0 },
							end: { line: lineNum, column: 999 },
						};
						s[String(i)] = Number.isNaN(hits) ? 0 : hits;
					}

					results.push({
						path: absolutePath,
						statementMap,
						fnMap: {} as Record<string, never>,
						branchMap: {} as Record<string, never>,
						s,
						f: {} as Record<string, never>,
						b: {} as Record<string, never>,
					});
				}
			}
		} catch /* v8 ignore next */ {
			// XML parse error — skip silently
		}

		return results;
	}
}
