import os from "node:os";
import { describe, test } from "vitest";
import sysinfo from "../scripts/sysinfo.sh";

describe("sysinfo.sh", () => {
	test("script exists and is executable", () => {
		sysinfo.raw('[ -f "$SCRIPT" ]');
		sysinfo.raw('[ -x "$SCRIPT" ]');
	});

	test("outputs valid JSON by default", () => {
		sysinfo.run('"$SCRIPT"');
		sysinfo.assert_success();
		sysinfo.assert_output({ partial: '"hostname"' });
		sysinfo.assert_output({ partial: '"os_type"' });
		sysinfo.assert_output({ partial: '"date"' });
	});

	test("detects OS type", () => {
		sysinfo.run('"$SCRIPT"');
		sysinfo.assert_success();
		sysinfo.assert_json_value("os_type", os.type());
	});

	test("outputs pretty format with --pretty flag", () => {
		sysinfo.run('"$SCRIPT" --pretty');
		sysinfo.assert_success();
		sysinfo.assert_output({ partial: "System Information" });
		sysinfo.assert_output({ partial: "Hostname:" });
		sysinfo.assert_output({ partial: "OS Type:" });
	});

	test("rejects unknown arguments", () => {
		sysinfo.run('"$SCRIPT" --invalid');
		sysinfo.assert_failure();
		sysinfo.assert_output({ partial: "Unknown option" });
	});

	test("displays help with --help flag", () => {
		sysinfo.run('"$SCRIPT" --help');
		sysinfo.assert_success();
		sysinfo.assert_output({ partial: "Usage:" });
	});
});
