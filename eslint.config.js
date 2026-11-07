import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";

export default defineConfig([
  { ignores: ["node_modules/", "dist/", "coverage/", ".idea/"] },
  js.configs.recommended,
  {
    // Extension sources run in the browser (service worker and popup).
    files: ["background.js", "popup.js", "lib/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, chrome: "readonly" }
    }
  },
  {
    // Build scripts and config files run in Node.
    files: ["scripts/**/*.js", "*.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node }
    }
  },
  {
    // Tests run in Node; popup tests opt into jsdom, so browser globals too.
    files: ["test/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser }
    }
  }
]);
