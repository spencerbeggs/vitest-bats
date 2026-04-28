import os from "node:os";
import { describe, expect, test } from "vitest";
import sysinfo from "../scripts/sysinfo.sh";

describe("sysinfo.sh", () => {
	test("outputs valid JSON by default", async () => {
		const result = await sysinfo.run();
		expect(result).toSucceed();
		expect(result).toOutputJson();
		expect(result).toHaveJsonPath("hostname");
		expect(result).toHaveJsonPath("os_type");
		expect(result).toHaveJsonPath("date");
	});

	test("detects OS type", async () => {
		const result = await sysinfo.run();
		expect(result).toSucceed();
		expect(result).toHaveJsonValue("os_type", os.type());
	});

	test("outputs pretty format with --pretty flag", async () => {
		const result = await sysinfo.run("--pretty");
		expect(result).toSucceed();
		expect(result).toContainOutput("System Information");
		expect(result).toContainOutput("Hostname:");
		expect(result).toContainOutput("OS Type:");
	});

	test("rejects unknown arguments", async () => {
		const result = await sysinfo.run("--invalid");
		expect(result).toFail();
		expect(result).toContainStderr("Unknown option");
	});

	test("displays help with --help flag", async () => {
		const result = await sysinfo.run("--help");
		expect(result).toSucceed();
		expect(result).toContainOutput("Usage:");
	});
});
