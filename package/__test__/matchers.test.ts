import { beforeAll, describe, expect, test } from "vitest";
import { batsMatchers } from "../src/matchers.js";
import { BatsResult } from "../src/runtime.js";

beforeAll(() => {
	expect.extend(batsMatchers);
});

const result = (
	overrides: Partial<{
		status: number;
		output: string;
		stderr: string;
		calls: Record<string, { args: string[] }[]>;
	}> = {},
) =>
	new BatsResult({
		status: 0,
		output: "",
		stderr: "",
		calls: {},
		...overrides,
	});

describe("status matchers", () => {
	test("toSucceed passes on status 0", () => {
		expect(result({ status: 0 })).toSucceed();
	});
	test("toSucceed fails on non-zero with stderr in message", () => {
		expect(() => expect(result({ status: 1, stderr: "oops" })).toSucceed()).toThrow(/status: 1/);
	});
	test("toFail passes on any non-zero", () => {
		expect(result({ status: 2 })).toFail();
	});
	test("toFail with code matches exactly", () => {
		expect(result({ status: 2 })).toFail(2);
		expect(() => expect(result({ status: 2 })).toFail(3)).toThrow();
	});
});

describe("output matchers", () => {
	test("toHaveOutput exact", () => {
		expect(result({ output: "abc" })).toHaveOutput("abc");
		expect(() => expect(result({ output: "ab" })).toHaveOutput("abc")).toThrow();
	});
	test("toContainOutput substring", () => {
		expect(result({ output: "Hello World" })).toContainOutput("World");
		expect(() => expect(result({ output: "Hi" })).toContainOutput("World")).toThrow();
	});
	test("toMatchOutput regex (RegExp)", () => {
		expect(result({ output: "Hello 42" })).toMatchOutput(/\d+/);
	});
	test("toMatchOutput regex (string)", () => {
		expect(result({ output: "Hello 42" })).toMatchOutput("\\d+");
	});
	test("toHaveEmptyOutput", () => {
		expect(result({ output: "" })).toHaveEmptyOutput();
		expect(() => expect(result({ output: "x" })).toHaveEmptyOutput()).toThrow();
	});
});

describe("stderr matchers", () => {
	test("toHaveStderr / toContainStderr / toMatchStderr", () => {
		expect(result({ stderr: "err" })).toHaveStderr("err");
		expect(result({ stderr: "warning: bad" })).toContainStderr("warning");
		expect(result({ stderr: "code 42" })).toMatchStderr(/\d+/);
	});
});

describe("line matchers", () => {
	test("toHaveLine at index", () => {
		expect(result({ output: "a\nb\nc" })).toHaveLine(1, "b");
		expect(() => expect(result({ output: "a\nb" })).toHaveLine(0, "b")).toThrow();
	});
	test("toHaveLineContaining without index searches all lines", () => {
		expect(result({ output: "alpha\nbeta\ngamma" })).toHaveLineContaining("eta");
	});
	test("toHaveLineContaining with index", () => {
		expect(result({ output: "alpha\nbeta" })).toHaveLineContaining("eta", 1);
		expect(() => expect(result({ output: "alpha\nbeta" })).toHaveLineContaining("alp", 1)).toThrow();
	});
	test("toHaveLineMatching regex", () => {
		expect(result({ output: "v1.2.3\nv1.2.4" })).toHaveLineMatching(/v\d+\.\d+\.\d+/);
	});
	test("toHaveLineCount", () => {
		expect(result({ output: "a\nb\nc" })).toHaveLineCount(3);
	});
});

describe("JSON matchers", () => {
	test("toOutputJson", () => {
		expect(result({ output: '{"a":1}' })).toOutputJson();
		expect(() => expect(result({ output: "not json" })).toOutputJson()).toThrow();
	});
	test("toEqualJson", () => {
		expect(result({ output: '{"a":1}' })).toEqualJson({ a: 1 });
		expect(() => expect(result({ output: '{"a":1}' })).toEqualJson({ a: 2 })).toThrow();
	});
	test("toMatchJson partial", () => {
		expect(result({ output: '{"a":1,"b":2}' })).toMatchJson({ a: 1 });
	});
	test("toHaveJsonValue lodash-style path", () => {
		expect(result({ output: '{"a":{"b":[{"c":42}]}}' })).toHaveJsonValue("a.b[0].c", 42);
		expect(() => expect(result({ output: '{"a":1}' })).toHaveJsonValue("a", 2)).toThrow();
	});
	test("toHaveJsonPath", () => {
		expect(result({ output: '{"a":{"b":1}}' })).toHaveJsonPath("a.b");
		expect(() => expect(result({ output: '{"a":1}' })).toHaveJsonPath("a.b")).toThrow();
	});
});

describe("schema matchers", () => {
	test("toMatchSchema with Standard Schema validator", () => {
		const schema = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: (v: unknown) => {
					if (typeof v === "object" && v !== null && "greeting" in v) return { value: v };
					return { issues: [{ message: "Required", path: ["greeting"] }] };
				},
			},
		};
		expect(result({ output: '{"greeting":"hi"}' })).toMatchSchema(schema);
		expect(() => expect(result({ output: "{}" })).toMatchSchema(schema)).toThrow(/greeting: Required/);
	});

	test("toMatchJsonSchema with raw JSON Schema", () => {
		const schema = {
			type: "object",
			properties: { greeting: { type: "string" } },
			required: ["greeting"],
		};
		expect(result({ output: '{"greeting":"hi"}' })).toMatchJsonSchema(schema);
		expect(() => expect(result({ output: "{}" })).toMatchJsonSchema(schema)).toThrow();
	});
});

describe("invocation matchers", () => {
	test("toHaveInvoked with args match", () => {
		const r = result({ calls: { git: [{ args: ["remote", "get-url", "origin"] }] } });
		expect(r).toHaveInvoked("git", { args: ["remote", "get-url", "origin"] });
		expect(() => expect(r).toHaveInvoked("git", { args: ["status"] })).toThrow();
	});
	test("toHaveInvoked without args (any call)", () => {
		const r = result({ calls: { git: [{ args: ["x"] }] } });
		expect(r).toHaveInvoked("git");
	});
	test("toHaveInvoked fails when cmd never called", () => {
		expect(() => expect(result()).toHaveInvoked("git")).toThrow();
	});
	test("toHaveInvokedTimes", () => {
		const r = result({ calls: { git: [{ args: ["a"] }, { args: ["b"] }] } });
		expect(r).toHaveInvokedTimes("git", 2);
		expect(() => expect(r).toHaveInvokedTimes("git", 1)).toThrow();
	});
	test("toHaveInvokedTimes 0", () => {
		expect(result()).toHaveInvokedTimes("git", 0);
	});
	test("toHaveInvokedExactly full history", () => {
		const r = result({ calls: { git: [{ args: ["a"] }, { args: ["b"] }] } });
		expect(r).toHaveInvokedExactly("git", [{ args: ["a"] }, { args: ["b"] }]);
		expect(() => expect(r).toHaveInvokedExactly("git", [{ args: ["a"] }])).toThrow();
	});
});

describe(".not negation works", () => {
	test("not.toSucceed", () => {
		expect(result({ status: 1 })).not.toSucceed();
	});
	test("not.toContainOutput", () => {
		expect(result({ output: "Hello" })).not.toContainOutput("World");
	});
});

describe("ensureBatsResult rejects non-BatsResult inputs", () => {
	test("rejects null", () => {
		expect(() => expect(null).toSucceed()).toThrow(/expected received value to be a BatsResult/);
	});
	test("rejects primitive", () => {
		expect(() => expect("not a result").toSucceed()).toThrow(/expected received value to be a BatsResult/);
	});
	test("rejects plain object missing required fields", () => {
		expect(() => expect({ status: 0 }).toSucceed()).toThrow(/expected received value to be a BatsResult/);
	});
	test("rejects shape-matching object that lacks the BATS_RESULT_BRAND symbol", () => {
		// Same shape as BatsResult but missing the Symbol.for-based brand —
		// the matcher should reject it. This guards against accidentally
		// passing a non-BatsResult that happens to look similar.
		class Imposter {
			status = 0;
			output = "";
			stderr = "";
			lines: string[] = [];
			calls = {};
			json() {
				return undefined;
			}
		}
		expect(() => expect(new Imposter()).toSucceed()).toThrow(/expected received value to be a BatsResult/);
	});
});

describe("output / stderr / line failure messages (covers message() bodies)", () => {
	test("toMatchOutput failure invokes message()", () => {
		expect(() => expect(result({ output: "no digits here" })).toMatchOutput(/\d+/)).toThrow(/expected output to match/);
	});
	test("toHaveStderr failure invokes message()", () => {
		expect(() => expect(result({ stderr: "actual" })).toHaveStderr("expected")).toThrow(/expected stderr to be/);
	});
	test("toContainStderr failure invokes message()", () => {
		expect(() => expect(result({ stderr: "abc" })).toContainStderr("xyz")).toThrow(/expected stderr to contain/);
	});
	test("toMatchStderr failure invokes message()", () => {
		expect(() => expect(result({ stderr: "no digits" })).toMatchStderr(/\d+/)).toThrow(/expected stderr to match/);
	});
	test("toHaveLineMatching failure with index invokes message()", () => {
		expect(() => expect(result({ output: "abc\ndef" })).toHaveLineMatching(/\d+/, 0)).toThrow(
			/expected lines\[0\] to match/,
		);
	});
	test("toHaveLineMatching failure without index invokes message()", () => {
		expect(() => expect(result({ output: "abc\ndef" })).toHaveLineMatching(/\d+/)).toThrow(
			/expected some line to match/,
		);
	});
	test("toHaveLineCount failure invokes message()", () => {
		expect(() => expect(result({ output: "a\nb" })).toHaveLineCount(5)).toThrow(/expected 5 line\(s\), got 2/);
	});
});

describe("JSON matchers with invalid JSON output (covers parse-error catch branches)", () => {
	const invalid = result({ output: "not json at all" });

	test("toEqualJson on invalid JSON", () => {
		expect(() => expect(invalid).toEqualJson({ a: 1 })).toThrow(/expected output to be valid JSON/);
	});
	test("toMatchJson on invalid JSON", () => {
		expect(() => expect(invalid).toMatchJson({ a: 1 })).toThrow(/expected output to be valid JSON/);
	});
	test("toMatchJson failure with valid JSON but mismatched shape invokes message()", () => {
		expect(() => expect(result({ output: '{"a":1}' })).toMatchJson({ b: 2 })).toThrow(/expected JSON output to match/);
	});
	test("toHaveJsonValue on invalid JSON", () => {
		expect(() => expect(invalid).toHaveJsonValue("a", 1)).toThrow(/expected output to be valid JSON/);
	});
	test("toHaveJsonPath on invalid JSON", () => {
		expect(() => expect(invalid).toHaveJsonPath("a")).toThrow(/expected output to be valid JSON/);
	});
	test("toMatchSchema on invalid JSON", () => {
		const schema = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: (v: unknown) => ({ value: v }),
			},
		};
		expect(() => expect(invalid).toMatchSchema(schema)).toThrow(/expected output to be valid JSON/);
	});
	test("toMatchJsonSchema on invalid JSON", () => {
		expect(() => expect(invalid).toMatchJsonSchema({ type: "object" })).toThrow(/expected output to be valid JSON/);
	});
});

describe("getPath edge cases (via toHaveJsonPath)", () => {
	test("numeric index out of range fails", () => {
		expect(() => expect(result({ output: '{"a":[1,2]}' })).toHaveJsonPath("a[5]")).toThrow(
			/expected JSON path "a\[5\]" to exist/,
		);
	});
	test("numeric index on non-array fails", () => {
		expect(() => expect(result({ output: '{"a":{"b":1}}' })).toHaveJsonPath("a[0]")).toThrow(
			/expected JSON path "a\[0\]" to exist/,
		);
	});
	test("string key on non-object fails", () => {
		expect(() => expect(result({ output: '{"a":"plain string"}' })).toHaveJsonPath("a.b")).toThrow(
			/expected JSON path "a\.b" to exist/,
		);
	});
	test("missing key fails (string-key branch)", () => {
		expect(() => expect(result({ output: '{"a":{"x":1}}' })).toHaveJsonPath("a.missing")).toThrow(
			/expected JSON path "a\.missing" to exist/,
		);
	});
});

describe("partialMatch via toMatchJson — array branches", () => {
	test("expected array matches when actual array contains expected elements", () => {
		expect(result({ output: '{"items":[{"id":1,"name":"a"},{"id":2,"name":"b"}]}' })).toMatchJson({
			items: [{ id: 1 }, { id: 2 }],
		});
	});
	test("expected array fails when actual is not array (covers !Array.isArray(actual) branch)", () => {
		expect(() => expect(result({ output: '{"items":"not an array"}' })).toMatchJson({ items: [{ id: 1 }] })).toThrow(
			/expected JSON output to match/,
		);
	});
});
