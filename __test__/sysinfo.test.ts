import os from "node:os";
import { BatsHelper } from "vitest-bats";

const scriptPath = import.meta.resolve("../scripts/sysinfo.sh");

BatsHelper.describe(scriptPath, (helper) => {
	helper.test("script exists and is executable", (script) => {
		script.raw('[ -f "$SCRIPT" ]');
		script.raw('[ -x "$SCRIPT" ]');
	});

	helper.test("outputs valid JSON by default", (script) => {
		script.run('"$SCRIPT"');
		script.assert_success();
		script.assert_output({ partial: '"hostname"' });
		script.assert_output({ partial: '"os_type"' });
		script.assert_output({ partial: '"date"' });
	});

	helper.test("detects OS type", (script) => {
		script.run('"$SCRIPT"');
		script.assert_success();
		script.assert_json_value("os_type", os.type());
	});

	helper.test("outputs pretty format with --pretty flag", (script) => {
		script.run('"$SCRIPT" --pretty');
		script.assert_success();
		script.assert_output({ partial: "System Information" });
		script.assert_output({ partial: "Hostname:" });
		script.assert_output({ partial: "OS Type:" });
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
