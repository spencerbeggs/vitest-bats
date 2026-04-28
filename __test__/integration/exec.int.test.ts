import { describe, expect, test } from "vitest";
// biome-ignore lint/correctness/useImportExtensions: .sh imports are handled by BatsPlugin's Vite transform
import hello from "../../scripts/hello.sh";

describe("exec() shell pipelines", () => {
	test("invokes script via shell with $SCRIPT interpolation", async () => {
		const result = await hello.exec('"$SCRIPT" --name Pipeline');
		expect(result).toSucceed();
		expect(result).toContainOutput("Hello Pipeline");
	});

	test("supports stdin pipelines", async () => {
		const result = await hello.exec('"$SCRIPT" | cat');
		expect(result).toSucceed();
		expect(result).toContainOutput("Hello World");
	});
});
