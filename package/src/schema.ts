import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv } from "ajv";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

// ajv-formats ships as CJS with both `module.exports = plugin` and
// `exports.default = plugin`. Under verbatimModuleSyntax we reach through
// .default to get the callable plugin.
const addFormats: FormatsPlugin = (addFormatsModule as unknown as { default: FormatsPlugin }).default;

export type ValidationResult = { ok: true } | { ok: false; issues: string[] };

let ajvSingleton: Ajv | null = null;

function getAjv(): Ajv {
	if (!ajvSingleton) {
		ajvSingleton = new Ajv({ strict: false, allErrors: true });
		addFormats(ajvSingleton);
	}
	return ajvSingleton;
}

const compiledCache = new WeakMap<object, ValidateFunction>();

export function isStandardSchema(schema: unknown): schema is StandardSchemaV1 {
	if (schema === null || typeof schema !== "object") return false;
	if (!("~standard" in schema)) return false;
	const std = (schema as StandardSchemaV1)["~standard"];
	return std !== null && typeof std === "object" && typeof std.validate === "function";
}

function pathToString(path: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined): string {
	if (!path || path.length === 0) return "(root)";
	return path
		.map((seg) => {
			const key = typeof seg === "object" && seg !== null && "key" in seg ? seg.key : seg;
			return typeof key === "number" ? `[${key}]` : String(key);
		})
		.reduce<string>((acc, cur) => {
			if (cur.startsWith("[")) return acc + cur;
			return acc.length === 0 ? cur : `${acc}.${cur}`;
		}, "");
}

function validateStandard(schema: StandardSchemaV1, value: unknown): ValidationResult {
	const result = schema["~standard"].validate(value);
	if (result instanceof Promise) {
		throw new Error(
			"vitest-bats: async Standard Schema validators are not supported. " +
				"Await result.json() and use a built-in matcher (e.g., await expect(...).resolves.toEqual(...)) instead.",
		);
	}
	if (!result.issues || result.issues.length === 0) {
		return { ok: true };
	}
	const issues = result.issues.map((i) => `${pathToString(i.path)}: ${i.message}`);
	return { ok: false, issues };
}

function validateJsonSchema(schema: object, value: unknown): ValidationResult {
	let compiled = compiledCache.get(schema);
	if (!compiled) {
		compiled = getAjv().compile(schema);
		compiledCache.set(schema, compiled);
	}
	const ok = compiled(value);
	if (ok) return { ok: true };
	const issues = (compiled.errors ?? []).map((err: ErrorObject) => {
		const path = err.instancePath || "(root)";
		return `${path}: ${err.message ?? "validation failed"}`;
	});
	return { ok: false, issues };
}

export function validate(schema: unknown, value: unknown): ValidationResult {
	if (isStandardSchema(schema)) {
		return validateStandard(schema, value);
	}
	if (schema !== null && typeof schema === "object") {
		return validateJsonSchema(schema as object, value);
	}
	throw new Error("vitest-bats: schema must be a Standard Schema validator or a JSON Schema object");
}
