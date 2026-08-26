import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: [".pi/extensions/webmcp/**/*.test.ts"],
		testTimeout: 5_000,
	},
});
