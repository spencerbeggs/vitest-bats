import { describe, expect, test } from "vitest";
import hello from "../scripts/hello.sh";

describe("hello.sh", () => {
	test("outputs default greeting", async () => {
		const result = await hello.run();
		expect(result).toSucceed();
		expect(result).toContainOutput("Hello World");
	});

	test("greets by name with --name flag", async () => {
		const result = await hello.run("--name", "Alice");
		expect(result).toSucceed();
		expect(result).toContainOutput("Hello Alice");
	});

	test("outputs JSON with --json flag", async () => {
		const result = await hello.run("--json");
		expect(result).toSucceed();
		expect(result).toHaveJsonValue("greeting", "Hello World");
	});

	test("outputs JSON with --name and --json flags", async () => {
		const result = await hello.run("--name", "Bob", "--json");
		expect(result).toSucceed();
		expect(result).toHaveJsonValue("greeting", "Hello Bob");
	});

	test("rejects unknown arguments", async () => {
		const result = await hello.run("--invalid");
		expect(result).toFail();
		expect(result).toContainStderr("Unknown option");
	});

	test("displays help with --help flag", async () => {
		const result = await hello.run("--help");
		expect(result).toSucceed();
		expect(result).toContainOutput("Usage:");
	});
});
