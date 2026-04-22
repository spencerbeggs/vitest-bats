import { describe, test } from "vitest";
import hello from "../scripts/hello.sh";

describe("hello.sh", () => {
	test("script exists and is executable", () => {
		hello.raw('[ -f "$SCRIPT" ]');
		hello.raw('[ -x "$SCRIPT" ]');
	});

	test("outputs default greeting", () => {
		hello.run('"$SCRIPT"');
		hello.assert_success();
		hello.assert_output({ partial: "Hello World" });
	});

	test("greets by name with --name flag", () => {
		hello.run('"$SCRIPT" --name Alice');
		hello.assert_success();
		hello.assert_output({ partial: "Hello Alice" });
	});

	test("outputs JSON with --json flag", () => {
		hello.run('"$SCRIPT" --json');
		hello.assert_success();
		hello.assert_json_value("greeting", "Hello World");
	});

	test("outputs JSON with --name and --json flags", () => {
		hello.run('"$SCRIPT" --name Bob --json');
		hello.assert_success();
		hello.assert_json_value("greeting", "Hello Bob");
	});

	test("rejects unknown arguments", () => {
		hello.run('"$SCRIPT" --invalid');
		hello.assert_failure();
		hello.assert_output({ partial: "Unknown option" });
	});

	test("displays help with --help flag", () => {
		hello.run('"$SCRIPT" --help');
		hello.assert_success();
		hello.assert_output({ partial: "Usage:" });
	});
});
