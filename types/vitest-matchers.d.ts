// =================================================================
// Vitest matcher augmentation for the root workspace.
//
// The published `vitest-bats` package declares these matchers in
// `package/src/matchers.ts`, but Microsoft API Extractor strips
// `declare module` blocks during the dist .d.ts roll-up. This local
// ambient mirrors the augmentation so the root workspace's typecheck
// (which resolves `vitest-bats` from `dist/dev`) still sees the matchers.
// Keep in sync with `package/src/matchers.ts`.
// =================================================================

// Force this file to be treated as a module so the `declare module`
// block below is an augmentation, not a module declaration that
// replaces the real `vitest` package.
import type {} from "vitest";

declare module "vitest" {
	interface Assertion {
		toSucceed(): void;
		toFail(code?: number): void;

		toHaveOutput(text: string): void;
		toContainOutput(text: string): void;
		toMatchOutput(pattern: RegExp | string): void;
		toHaveEmptyOutput(): void;

		toHaveStderr(text: string): void;
		toContainStderr(text: string): void;
		toMatchStderr(pattern: RegExp | string): void;

		toHaveLine(index: number, text: string): void;
		toHaveLineContaining(text: string, index?: number): void;
		toHaveLineMatching(pattern: RegExp | string, index?: number): void;
		toHaveLineCount(n: number): void;

		toOutputJson(): void;
		toEqualJson(expected: unknown): void;
		toMatchJson(partial: object): void;
		toHaveJsonValue(path: string, expected: unknown): void;
		toHaveJsonPath(path: string): void;

		toMatchSchema(schema: unknown): void;
		toMatchJsonSchema(schema: object): void;

		toHaveInvoked(cmd: string, opts?: { args?: string[] }): void;
		toHaveInvokedTimes(cmd: string, n: number): void;
		toHaveInvokedExactly(cmd: string, calls: { args: string[] }[]): void;
	}

	interface AsymmetricMatchersContaining {
		toSucceed(): void;
		toFail(code?: number): void;
		toHaveOutput(text: string): void;
		toContainOutput(text: string): void;
		toMatchOutput(pattern: RegExp | string): void;
		toHaveEmptyOutput(): void;
		toHaveStderr(text: string): void;
		toContainStderr(text: string): void;
		toMatchStderr(pattern: RegExp | string): void;
		toHaveLine(index: number, text: string): void;
		toHaveLineContaining(text: string, index?: number): void;
		toHaveLineMatching(pattern: RegExp | string, index?: number): void;
		toHaveLineCount(n: number): void;
		toOutputJson(): void;
		toEqualJson(expected: unknown): void;
		toMatchJson(partial: object): void;
		toHaveJsonValue(path: string, expected: unknown): void;
		toHaveJsonPath(path: string): void;
		toMatchSchema(schema: unknown): void;
		toMatchJsonSchema(schema: object): void;
		toHaveInvoked(cmd: string, opts?: { args?: string[] }): void;
		toHaveInvokedTimes(cmd: string, n: number): void;
		toHaveInvokedExactly(cmd: string, calls: { args: string[] }[]): void;
	}
}
