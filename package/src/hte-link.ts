/**
 * HTELink - Hypertext Escape (OSC 8) Link Generator
 *
 * @remarks
 * Utility module for generating OSC 8 hyperlinks in terminal output.
 * Supports both plain text and clickable hyperlinks based on configuration.
 *
 * OSC 8 is a terminal escape sequence standard for creating clickable hyperlinks
 * in terminal emulators. The format is: `\u001b]8;;URL\u001b\\TEXT\u001b]8;;\u001b\\`
 *
 * @see {@link https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda | OSC 8 Hyperlinks Specification}
 *
 * @packageDocumentation
 */

import type { LinkFormat } from "./vitest-kcov-types.js";

/**
 * Configuration options for HTELink instance.
 *
 * @remarks
 * Controls the behavior of hyperlink generation, including terminal detection,
 * debug output, and visual styling of clickable links.
 */
export interface HTELinkOptions {
	/**
	 * Link format mode.
	 *
	 * @remarks
	 * - "auto": Automatically detect terminal support for OSC 8 hyperlinks
	 * - "default": Always use plain text (no hyperlinks)
	 * - "hte": Always use OSC 8 hyperlinks (may not render in unsupported terminals)
	 *
	 * @defaultValue "auto"
	 */
	mode?: LinkFormat;

	/**
	 * Enable debug logging to console.
	 *
	 * @remarks
	 * When enabled, logs terminal detection details and link creation information
	 * to help troubleshoot hyperlink rendering issues.
	 *
	 * @defaultValue false
	 */
	debug?: boolean;

	/**
	 * Add visual indicators (underline) to clickable links.
	 *
	 * @remarks
	 * When enabled in HTE mode, applies underline styling (`\u001b[4m`) to the
	 * display text to visually indicate that it is clickable. Has no effect in
	 * "default" mode.
	 *
	 * @defaultValue true
	 */
	visualIndicator?: boolean;

	/**
	 * Path rewriting configuration for Docker/container environments.
	 *
	 * @remarks
	 * When running in a Docker container, file paths in URLs may reference container
	 * paths (e.g., `/workspace/...`) that don't exist on the host machine. This option
	 * enables automatic path rewriting to convert container paths to host paths.
	 *
	 * If not specified, checks the `HTE_PATH_REWRITE` environment variable in the format:
	 * `container_prefix:host_prefix` (e.g., `/workspace:/Users/spencer/project`)
	 *
	 * @example
	 * ```typescript
	 * // Explicit configuration
	 * const linker = new HTELink({
	 *   mode: "hte",
	 *   pathRewrite: {
	 *     from: "/workspace",
	 *     to: "/Users/spencer/workspaces/savvy-web/claude-tools"
	 *   }
	 * });
	 *
	 * // Environment variable (in docker-compose.yml)
	 * // HTE_PATH_REWRITE=/workspace:/Users/spencer/workspaces/savvy-web/claude-tools
	 * const linker = new HTELink({ mode: "hte" });
	 * ```
	 *
	 * @defaultValue undefined (no path rewriting)
	 */
	pathRewrite?: {
		/** Container path prefix to replace (e.g., "/workspace") */
		from: string;
		/** Host path prefix to use instead (e.g., "/Users/spencer/project") */
		to: string;
	};
}

/**
 * HTELink - Hypertext Escape Link Generator
 *
 * @remarks
 * Creates OSC 8 hyperlinks for terminal output. When mode is "hte", generates
 * clickable links with optional visual indicators (underline). When mode is
 * "default", returns plain text.
 *
 * @example
 * ```typescript
 * // With visual indicator (default)
 * const linker = new HTELink({ mode: "hte" });
 * const link = linker.create("https://example.com", "Example");
 * // Returns: "\u001b]8;;https://example.com\u001b\\\u001b[4mExample\u001b[24m\u001b]8;;\u001b\\"
 * // (underlined clickable link)
 *
 * // Without visual indicator
 * const linker = new HTELink({ mode: "hte", visualIndicator: false });
 * const link = linker.create("https://example.com", "Example");
 * // Returns: "\u001b]8;;https://example.com\u001b\\Example\u001b]8;;\u001b\\"
 * // (clickable link without underline)
 * ```
 */
export class HTELink {
	private mode: LinkFormat;
	private debug: boolean;
	private effectiveMode: "default" | "hte";
	private visualIndicator: boolean;
	private pathRewrite?: { from: string; to: string };

	/**
	 * Detect if the current terminal supports OSC 8 hyperlinks.
	 *
	 * @remarks
	 * Performs environment variable inspection to determine if the current terminal
	 * emulator supports the OSC 8 hyperlink standard. This detection is used when
	 * HTELink is configured with `mode: "auto"`.
	 *
	 * Can be forced via environment variable:
	 * - **FORCE_HTE_LINKS=1**: Force enable OSC 8 hyperlinks (useful for Docker/CI environments)
	 *
	 * Currently supports detection for:
	 * - **VSCode** integrated terminal: Checks `VSCODE_INJECTION=1`
	 * - **iTerm2** (version > 3.1): Checks `TERM_PROGRAM=iTerm.app` and parses `TERM_PROGRAM_VERSION`
	 * - **WezTerm**: Checks `TERM_PROGRAM=WezTerm`
	 *
	 * @returns `true` if the terminal supports OSC 8 hyperlinks, `false` otherwise
	 *
	 * @example
	 * ```typescript
	 * if (HTELink.detect()) {
	 *   console.log("Terminal supports clickable links!");
	 *   const linker = new HTELink({ mode: "hte" });
	 * } else {
	 *   console.log("Falling back to plain text");
	 *   const linker = new HTELink({ mode: "default" });
	 * }
	 *
	 * // Force HTE links in Docker
	 * FORCE_HTE_LINKS=1 docker run ...
	 * ```
	 *
	 * @see {@link HTELink.constructor} for automatic detection with `mode: "auto"`
	 */
	static detect(): boolean {
		// Check for forced HTE links (useful for Docker/CI environments)
		if (process.env.FORCE_HTE_LINKS === "1" || process.env.FORCE_HTE_LINKS === "true") {
			return true;
		}

		// Check for VSCode integrated terminal
		if (process.env.VSCODE_INJECTION === "1") {
			return true;
		}

		// Check for iTerm2 > 3.1
		if (process.env.TERM_PROGRAM === "iTerm.app") {
			const version = process.env.TERM_PROGRAM_VERSION;
			if (version) {
				const [major, minor] = version.split(".").map(Number);
				if (major > 3 || (major === 3 && minor > 1)) {
					return true;
				}
			}
		}

		// Check for WezTerm
		if (process.env.TERM_PROGRAM === "WezTerm") {
			return true;
		}

		return false;
	}

	/**
	 * Creates a new HTELink instance with the specified configuration.
	 *
	 * @remarks
	 * Initializes the hyperlink generator and resolves the effective link mode.
	 * When `mode` is set to "auto", automatically detects terminal support for
	 * OSC 8 hyperlinks using {@link HTELink.detect}.
	 *
	 * If debug mode is enabled, logs initialization details including:
	 * - The requested mode and effective (resolved) mode
	 * - Terminal environment variables used for detection
	 * - Visual indicator setting
	 * - Path rewriting configuration (if enabled)
	 *
	 * **Path Rewriting for Docker/Containers:**
	 *
	 * When running tests in Docker, file paths in URLs reference container paths
	 * (e.g., `/workspace/...`) that don't exist on the host. Path rewriting converts
	 * these to host paths automatically.
	 *
	 * Configure via explicit option or `HTE_PATH_REWRITE` environment variable:
	 * - Format: `container_prefix:host_prefix`
	 * - Example: `HTE_PATH_REWRITE=/workspace:/Users/spencer/project`
	 *
	 * @param options - Configuration options for the HTELink instance
	 * @param options.mode - Link format mode (default: "auto")
	 * @param options.debug - Enable debug logging (default: false)
	 * @param options.visualIndicator - Add underline to clickable links (default: true)
	 * @param options.pathRewrite - Path rewriting config for Docker (default: from HTE_PATH_REWRITE env var)
	 *
	 * @example
	 * ```typescript
	 * // Auto-detect terminal support (recommended)
	 * const linker = new HTELink({ mode: "auto" });
	 *
	 * // Force HTE mode (always use hyperlinks)
	 * const linker = new HTELink({ mode: "hte" });
	 *
	 * // Use plain text only (no hyperlinks)
	 * const linker = new HTELink({ mode: "default" });
	 *
	 * // Enable debug output for troubleshooting
	 * const linker = new HTELink({ mode: "auto", debug: true });
	 *
	 * // Disable visual indicators (no underline)
	 * const linker = new HTELink({ mode: "hte", visualIndicator: false });
	 *
	 * // Docker path rewriting (explicit configuration)
	 * const linker = new HTELink({
	 *   mode: "hte",
	 *   pathRewrite: {
	 *     from: "/workspace",
	 *     to: "/Users/spencer/workspaces/savvy-web/claude-tools"
	 *   }
	 * });
	 *
	 * // Docker path rewriting (via environment variable)
	 * // Set HTE_PATH_REWRITE=/workspace:/Users/spencer/project
	 * const linker = new HTELink({ mode: "hte" });
	 * ```
	 *
	 * @see {@link HTELink.detect} for terminal detection logic
	 * @see {@link HTELinkOptions} for all available configuration options
	 */
	constructor(options: HTELinkOptions = {}) {
		this.mode = options.mode || "auto";
		this.debug = options.debug ?? false;
		this.visualIndicator = options.visualIndicator ?? true; // Default to true

		// Configure path rewriting (explicit config or environment variable)
		if (options.pathRewrite) {
			this.pathRewrite = options.pathRewrite;
		} else if (process.env.HTE_PATH_REWRITE) {
			// Parse HTE_PATH_REWRITE environment variable: "from:to"
			const parts = process.env.HTE_PATH_REWRITE.split(":");
			if (parts.length >= 2) {
				// Join with : in case the host path contains colons (e.g., Windows C:\)
				this.pathRewrite = {
					from: parts[0],
					to: parts.slice(1).join(":"),
				};
			}
		}

		// Resolve "auto" mode to effective mode
		if (this.mode === "auto") {
			this.effectiveMode = HTELink.detect() ? "hte" : "default";
		} else {
			this.effectiveMode = this.mode;
		}

		if (this.debug) {
			console.log(`🔗 HTELink initialized with mode: ${this.mode}`);
			if (this.mode === "auto") {
				console.log(`   Auto-detected: ${this.effectiveMode}`);
				console.log(`   FORCE_HTE_LINKS: ${process.env.FORCE_HTE_LINKS}`);
				console.log(`   VSCODE_INJECTION: ${process.env.VSCODE_INJECTION}`);
				console.log(`   TERM_PROGRAM: ${process.env.TERM_PROGRAM}`);
				console.log(`   TERM_PROGRAM_VERSION: ${process.env.TERM_PROGRAM_VERSION}`);
			}
			console.log(`   Visual indicator: ${this.visualIndicator}`);
			if (this.pathRewrite) {
				console.log(`   Path rewrite: ${this.pathRewrite.from} → ${this.pathRewrite.to}`);
			}
		}
	}

	/**
	 * Create a hyperlink (OSC 8) or plain text based on mode.
	 *
	 * @remarks
	 * When in HTE mode with visual indicators enabled (default), the display text
	 * will be underlined to visually indicate that it is clickable.
	 *
	 * @param url - The URL to link to (e.g., "https://example.com" or "vscode://file/path")
	 * @param displayText - The text to display in the terminal
	 * @returns Formatted hyperlink or plain text
	 *
	 * @example
	 * ```typescript
	 * // HTE mode with visual indicator (default)
	 * const linker = new HTELink({ mode: "hte" });
	 * linker.create("file:///path/to/file.html", "file.html");
	 * // Returns clickable link with underline: "\u001b]8;;file:///...\u001b\\\u001b[4mfile.html\u001b[24m\u001b]8;;\u001b\\"
	 *
	 * // HTE mode without visual indicator
	 * const linker = new HTELink({ mode: "hte", visualIndicator: false });
	 * linker.create("file:///path/to/file.html", "file.html");
	 * // Returns clickable link without underline
	 *
	 * // Default mode
	 * const linker = new HTELink({ mode: "default" });
	 * linker.create("file:///path/to/file.html", "file.html");
	 * // Returns: "file.html"
	 * ```
	 */
	create(url: string, displayText: string): string {
		if (this.effectiveMode === "hte") {
			// Apply path rewriting if configured (for Docker/container environments)
			let rewrittenUrl = url;
			if (this.pathRewrite) {
				// Handle vscode://, file://, and plain paths
				if (url.startsWith("vscode://file")) {
					// Extract the path from vscode://file URL
					const urlPath = url.slice(13); // Remove "vscode://file"
					if (urlPath.startsWith(this.pathRewrite.from)) {
						const newPath = urlPath.replace(this.pathRewrite.from, this.pathRewrite.to);
						rewrittenUrl = `vscode://file${newPath}`;
						if (this.debug) {
							console.log(`  Path rewrite: ${url} → ${rewrittenUrl}`);
						}
					}
				} else if (url.startsWith("file://")) {
					// Extract the path from file:// URL
					const urlPath = url.slice(7); // Remove "file://"
					if (urlPath.startsWith(this.pathRewrite.from)) {
						const newPath = urlPath.replace(this.pathRewrite.from, this.pathRewrite.to);
						rewrittenUrl = `file://${newPath}`;
						if (this.debug) {
							console.log(`  Path rewrite: ${url} → ${rewrittenUrl}`);
						}
					}
				} else if (url.startsWith(this.pathRewrite.from)) {
					// Plain path without URL scheme prefix
					rewrittenUrl = url.replace(this.pathRewrite.from, this.pathRewrite.to);
					if (this.debug) {
						console.log(`  Path rewrite: ${url} → ${rewrittenUrl}`);
					}
				}
			}

			// OSC 8 hyperlink format: \u001b]8;;URL\u001b\\TEXT\u001b]8;;\u001b\\
			// Add underline styling to the display text if visual indicator is enabled
			const styledText = this.visualIndicator
				? `\u001b[4m${displayText}\u001b[24m` // \u001b[4m = underline, \u001b[24m = no underline
				: displayText;

			const link = `\u001b]8;;${rewrittenUrl}\u001b\\${styledText}\u001b]8;;\u001b\\`;

			if (this.debug) {
				console.log(`  Creating link: ${JSON.stringify({ url: rewrittenUrl, displayText, styledText, link })}`);
			}

			return link;
		}

		return displayText;
	}

	/**
	 * Write a hyperlink directly to stdout (without newline).
	 *
	 * @remarks
	 * Uses `process.stdout.write()` instead of `console.log()` to preserve
	 * OSC 8 escape sequences when running through tools like Vitest that might
	 * intercept or modify console output.
	 *
	 * This method is recommended when integrating with testing frameworks or
	 * custom reporters that need to maintain exact control over terminal output.
	 *
	 * @param url - The URL to link to (e.g., "file:///path/to/file" or "https://example.com")
	 * @param displayText - The text to display in the terminal
	 *
	 * @example
	 * ```typescript
	 * const linker = new HTELink({ mode: "hte" });
	 *
	 * // Write a clickable file link
	 * linker.write("file:///path/to/report.html", "View Report");
	 *
	 * // Write multiple links on the same line
	 * linker.write("file:///src/foo.ts", "foo.ts");
	 * process.stdout.write(" - ");
	 * linker.write("file:///src/bar.ts", "bar.ts");
	 * process.stdout.write("\n");
	 * ```
	 *
	 * @see {@link writeln} for writing with a trailing newline
	 * @see {@link create} for getting the formatted string without writing
	 */
	write(url: string, displayText: string): void {
		const formatted = this.create(url, displayText);

		if (this.effectiveMode === "hte") {
			// Write directly to stdout to bypass output interception
			process.stdout.write(formatted);
		} else {
			// For plain text, console.log is fine
			process.stdout.write(formatted);
		}
	}

	/**
	 * Write a hyperlink with a trailing newline directly to stdout.
	 *
	 * @remarks
	 * Convenience method that calls {@link write} followed by a newline character.
	 * Equivalent to `write(url, displayText)` followed by `process.stdout.write("\n")`.
	 *
	 * @param url - The URL to link to (e.g., "file:///path/to/file" or "https://example.com")
	 * @param displayText - The text to display in the terminal
	 *
	 * @example
	 * ```typescript
	 * const linker = new HTELink({ mode: "hte" });
	 *
	 * // Write clickable links, each on their own line
	 * linker.writeln("file:///src/foo.ts", "foo.ts");
	 * linker.writeln("file:///src/bar.ts", "bar.ts");
	 * linker.writeln("file:///src/baz.ts", "baz.ts");
	 * ```
	 *
	 * @see {@link write} for writing without a trailing newline
	 */
	writeln(url: string, displayText: string): void {
		this.write(url, displayText);
		process.stdout.write("\n");
	}

	/**
	 * Get the configured link mode.
	 *
	 * @remarks
	 * Returns the mode specified during construction, which may be "auto", "default", or "hte".
	 * Note that this returns the originally configured mode, not the resolved effective mode.
	 *
	 * @returns The configured link format mode
	 *
	 * @example
	 * ```typescript
	 * const linker = new HTELink({ mode: "auto" });
	 * console.log(linker.getMode()); // "auto"
	 * ```
	 *
	 * @see {@link isHTEMode} to check the resolved effective mode
	 */
	getMode(): LinkFormat {
		return this.mode;
	}

	/**
	 * Check if HTE (hyperlink) mode is enabled after auto-detection.
	 *
	 * @remarks
	 * Returns the resolved effective mode after terminal detection. This is the mode
	 * actually used when generating links:
	 * - If configured mode is "auto", returns the result of terminal detection
	 * - If configured mode is "hte", always returns `true`
	 * - If configured mode is "default", always returns `false`
	 *
	 * This method is useful for conditional logic that depends on whether hyperlinks
	 * will actually be generated.
	 *
	 * @returns `true` if OSC 8 hyperlinks will be generated, `false` if plain text will be used
	 *
	 * @example
	 * ```typescript
	 * const linker = new HTELink({ mode: "auto" });
	 *
	 * if (linker.isHTEMode()) {
	 *   console.log("Hyperlinks are enabled - clickable output available");
	 * } else {
	 *   console.log("Plain text mode - consider providing full URLs");
	 * }
	 * ```
	 *
	 * @see {@link getMode} to get the originally configured mode
	 * @see {@link HTELink.detect} for the detection logic used in "auto" mode
	 */
	isHTEMode(): boolean {
		return this.effectiveMode === "hte";
	}
}
