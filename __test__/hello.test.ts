import { BatsHelper } from "vitest-bats";

const scriptPath = import.meta.resolve("../scripts/hello.sh");

BatsHelper.describe(scriptPath, (helper) => {
	helper.test("script exists and is executable", (script) => {
		script.raw('[ -f "$SCRIPT" ]');
		script.raw('[ -x "$SCRIPT" ]');
	});

	helper.test("outputs default greeting", (script) => {
		script.run('"$SCRIPT"');
		script.assert_success();
		script.assert_output({ partial: "Hello World" });
	});

	helper.test("greets by name with --name flag", (script) => {
		script.run('"$SCRIPT" --name Alice');
		script.assert_success();
		script.assert_output({ partial: "Hello Alice" });
	});

	helper.test("outputs JSON with --json flag", (script) => {
		script.run('"$SCRIPT" --json');
		script.assert_success();
		script.assert_json_value("greeting", "Hello World");
	});

	helper.test("outputs JSON with --name and --json flags", (script) => {
		script.run('"$SCRIPT" --name Bob --json');
		script.assert_success();
		script.assert_json_value("greeting", "Hello Bob");
	});

	helper.test("rejects unknown arguments", (script) => {
		script.run('"$SCRIPT" --invalid');
		script.assert_failure();
		script.assert_output({ partial: "Unknown option" });
	});

	helper.test("displays help with --help flag", (script) => {
		script.run('"$SCRIPT" --help');
		script.assert_success();
		script.assert_output({ partial: "Usage:" });
	});
});
