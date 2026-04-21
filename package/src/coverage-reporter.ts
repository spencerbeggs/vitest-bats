import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";

interface IstanbulLocation {
	start: { line: number; column: number };
	end: { line: number; column: number };
}

interface IstanbulFileCoverage {
	path: string;
	statementMap: Record<string, IstanbulLocation>;
	fnMap: Record<string, never>;
	branchMap: Record<string, never>;
	s: Record<string, number>;
	f: Record<string, never>;
	b: Record<string, never>;
}

interface CoberturaLine {
	"@_number": string;
	"@_hits": string;
}

export class BatsCoverageReporter {
	private cacheDir: string;

	constructor(cacheDir: string) {
		this.cacheDir = cacheDir;
	}

	onCoverage(coverage: unknown): void {
		if (!coverage || typeof coverage !== "object") return;

		const coverageMap = coverage as {
			addFileCoverage?: (fc: IstanbulFileCoverage) => void;
		};
		if (typeof coverageMap.addFileCoverage !== "function") return;

		const kcovDir = resolve(this.cacheDir, "kcov");
		if (!existsSync(kcovDir)) return;

		const coberturaFiles = this.findCoberturaFiles(kcovDir);
		for (const coberturaPath of coberturaFiles) {
			const fileCoverages = this.parseCoberturaToIstanbul(coberturaPath);
			for (const fc of fileCoverages) {
				coverageMap.addFileCoverage(fc);
			}
		}
	}

	private findCoberturaFiles(dir: string): string[] {
		const results: string[] = [];
		try {
			const entries = readdirSync(dir);
			for (const entry of entries) {
				const fullPath = resolve(dir, entry);
				if (statSync(fullPath).isDirectory()) {
					const cobertura = resolve(fullPath, "cobertura.xml");
					if (existsSync(cobertura)) {
						results.push(cobertura);
					}
				}
			}
		} catch {
			// Directory not readable
		}
		return results;
	}

	private parseCoberturaToIstanbul(coberturaPath: string): IstanbulFileCoverage[] {
		const results: IstanbulFileCoverage[] = [];

		try {
			const xmlContent = readFileSync(coberturaPath, "utf-8");
			const parser = new XMLParser({
				ignoreAttributes: false,
				attributeNamePrefix: "@_",
			});
			const parsed = parser.parse(xmlContent);

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
		} catch {
			// XML parse error — skip silently
		}

		return results;
	}
}
