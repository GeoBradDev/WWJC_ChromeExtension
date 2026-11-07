import { defineConfig } from "vitest/config";

// Default node environment. Popup tests opt into jsdom with a per-file
// "// @vitest-environment jsdom" comment.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"]
  }
});
