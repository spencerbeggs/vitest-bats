import { describe, expect, test } from "vitest";
import { isStandardSchema, validate } from "../src/schema.js";

const standardOk = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (value: unknown) => ({ value }),
	},
};

const standardFail = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (_value: unknown) => ({
			issues: [
				{ message: "Required", path: ["greeting"] },
				{ message: "Must be string", path: ["nested", "field"] },
			],
		}),
	},
};

const standardAsync = {
	"~standard": {
		version: 1,
		vendor: "test",
		validate: (_value: unknown) => Promise.resolve({ value: _value }),
	},
};

describe("isStandardSchema", () => {
	test("detects validator with ~standard property", () => {
		expect(isStandardSchema(standardOk)).toBe(true);
	});

	test("rejects raw JSON Schema object", () => {
		expect(isStandardSchema({ type: "object" })).toBe(false);
	});

	test("rejects null and primitives", () => {
		expect(isStandardSchema(null)).toBe(false);
		expect(isStandardSchema("schema")).toBe(false);
		expect(isStandardSchema(42)).toBe(false);
	});

	test("rejects ~standard without a validate function (typed-only schema)", () => {
		const typedOnly = {
			"~standard": {
				version: 1,
				vendor: "test",
				// no validate function — this is a "typed schema" shape
			},
		};
		expect(isStandardSchema(typedOnly)).toBe(false);
	});
});

describe("validate (Standard Schema)", () => {
	test("returns ok on success", () => {
		const result = validate(standardOk, { hello: "world" });
		expect(result.ok).toBe(true);
	});

	test("returns issues on failure with formatted paths", () => {
		const result = validate(standardFail, {});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues).toEqual(["greeting: Required", "nested.field: Must be string"]);
		}
	});

	test("throws on async validator", () => {
		expect(() => validate(standardAsync, {})).toThrow(/async Standard Schema validators are not supported/);
	});
});

describe("validate (raw JSON Schema)", () => {
	const schema = {
		type: "object",
		properties: {
			greeting: { type: "string" },
			count: { type: "number", minimum: 0 },
		},
		required: ["greeting"],
	};

	test("returns ok on valid value", () => {
		const result = validate(schema, { greeting: "Hello", count: 1 });
		expect(result.ok).toBe(true);
	});

	test("returns issues on invalid value", () => {
		const result = validate(schema, { count: -1 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.issues.length).toBeGreaterThan(0);
			expect(result.issues.some((i) => i.includes("greeting"))).toBe(true);
		}
	});

	test("collects all errors with allErrors", () => {
		const result = validate(schema, { count: -1 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			// Both missing 'greeting' and invalid 'count' should be reported
			expect(result.issues.length).toBeGreaterThanOrEqual(2);
		}
	});
});
