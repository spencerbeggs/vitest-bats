/**
 * Platform detection utilities
 */
import { type as osType } from "node:os";

/**
 * Check if the current platform is macOS (Darwin)
 *
 * @remarks
 * Uses `os.type()` instead of `process.platform` to distinguish macOS from other Darwin-based systems.
 * Returns true for macOS, false for Linux, Windows, and other platforms.
 *
 * @returns True if running on macOS, false otherwise
 *
 * @example
 * ```typescript
 * if (isMacOS()) {
 *   console.log("Running on macOS");
 * }
 * ```
 */
export function isMacOS(): boolean {
	return osType() === "Darwin";
}
