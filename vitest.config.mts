import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Generated UI previews can contain old copies of the repository/tests.
    // Keep root/component tests, but never run generated repository copies.
    include: ["**/*.test.ts"],
    exclude: [...configDefaults.exclude, "test-results/**", ".next/**"],
  },
});
