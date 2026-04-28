import { beforeEach, expect } from "vitest";
import { batsMatchers } from "./matchers.js";
import { resetAllBuilders } from "./runtime.js";

expect.extend(batsMatchers);

beforeEach(() => {
	resetAllBuilders();
});
