import { describe, expect, test } from "vitest";
// biome-ignore lint/correctness/useImportExtensions: .sh imports are handled by BatsPlugin's Vite transform
import gitScript from "../../scripts/uses-git.sh";
// biome-ignore lint/correctness/useImportExtensions: .sh imports are handled by BatsPlugin's Vite transform
import widgetScript from "../../scripts/uses-widget.sh";

describe("mock call recording", () => {
	test("records git invocation with correct args", async () => {
		const result = await gitScript.mock("git", { "remote get-url *": "echo https://example.com" }).run();
		expect(result).toSucceed();
		expect(result).toContainOutput("https://example.com");
		expect(result).toHaveInvoked("git", { args: ["remote", "get-url", "origin"] });
		// Note: no strict-count assertion against `git` because kcov (when
		// coverage is on) calls `git rev-parse --is-inside-work-tree`
		// internally during instrumentation, which goes through our
		// recorder shim and inflates the count. For strict-count tests,
		// mock a binary kcov never invokes — see the widget-cli test below.
	});

	test("call history preserves whitespace in args", async () => {
		const result = await gitScript.mock("git", { "remote get-url *": "echo with spaces and 'quotes'" }).run();
		expect(result).toSucceed();
		expect(result).toContainOutput("with spaces");
	});

	test("strict call counts work for binaries kcov never touches", async () => {
		// widget-cli is fictional — no coverage tool has any reason to
		// invoke it, so the recorder only sees the script's calls.
		const result = await widgetScript
			.mock("widget-cli", {
				init: "echo initialized",
				"build --target=*": "echo built target",
				"ship *": "echo shipped",
			})
			.run();
		expect(result).toSucceed();
		expect(result).toHaveInvokedTimes("widget-cli", 3);
		expect(result).toHaveInvoked("widget-cli", { args: ["init"] });
		expect(result).toHaveInvoked("widget-cli", { args: ["build", "--target=foo"] });
		expect(result).toHaveInvoked("widget-cli", { args: ["ship", "release with spaces"] });
		expect(result).toHaveInvokedExactly("widget-cli", [
			{ args: ["init"] },
			{ args: ["build", "--target=foo"] },
			{ args: ["ship", "release with spaces"] },
		]);
	});
});
