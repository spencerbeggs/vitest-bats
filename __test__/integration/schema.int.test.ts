import { describe, expect, test } from "vitest";
// biome-ignore lint/correctness/useImportExtensions: .sh imports are handled by BatsPlugin's Vite transform
import hook from "../../scripts/hook.sh";

const HookJsonSchema = {
	type: "object",
	properties: {
		decision: { type: "string", enum: ["approve", "block"] },
		reason: { type: "string" },
	},
	required: ["decision", "reason"],
} as const;

const HookStandardSchema = {
	"~standard": {
		version: 1,
		vendor: "test-inline",
		validate: (v: unknown) => {
			if (
				typeof v === "object" &&
				v !== null &&
				"decision" in v &&
				"reason" in v &&
				typeof (v as { decision: unknown }).decision === "string" &&
				typeof (v as { reason: unknown }).reason === "string" &&
				((v as { decision: string }).decision === "approve" || (v as { decision: string }).decision === "block")
			) {
				return { value: v };
			}
			return { issues: [{ message: "Invalid hook response", path: [] }] };
		},
	},
};

describe("schema validation", () => {
	test("toMatchJsonSchema validates raw JSON Schema", async () => {
		const result = await hook.run();
		expect(result).toSucceed();
		expect(result).toMatchJsonSchema(HookJsonSchema);
	});

	test("toMatchSchema validates Standard Schema", async () => {
		const result = await hook.run();
		expect(result).toSucceed();
		expect(result).toMatchSchema(HookStandardSchema);
	});

	test("toMatchJsonSchema fails with helpful issues for invalid output", async () => {
		const result = await hook.run("--decision", "maybe");
		expect(result).toSucceed();
		expect(() => expect(result).toMatchJsonSchema(HookJsonSchema)).toThrow(/decision/);
	});

	test("typed json access via generic", async () => {
		const result = await hook.run("--decision", "block", "--reason", "policy");
		expect(result).toSucceed();
		const data = result.json<{ decision: string; reason: string }>();
		expect(data.decision).toBe("block");
		expect(data.reason).toBe("policy");
	});
});
