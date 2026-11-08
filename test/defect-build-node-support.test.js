// Frozen regression tests for the third review round of scripts/build.js:
// silent no-op on Node without import.meta.main, and the scheme of a
// scheme-less --api-url (which can be a username) being echoed.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { entryDecision, unsupportedNodeMessage } from "../scripts/build.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const modulePath = join(root, "scripts", "build.js");

describe("entryDecision", () => {
  it.each([
    ["import.meta.main true", { main: true, argv1: modulePath }, "run"],
    ["import.meta.main false", { main: false, argv1: modulePath }, "skip"],
    ["no import.meta.main, run as scripts/build.js", { main: undefined, argv1: modulePath }, "unsupported"],
    ["no import.meta.main, run as scripts/build", { main: undefined, argv1: join(root, "scripts", "build") }, "unsupported"],
    ["no import.meta.main, imported by another entry", { main: undefined, argv1: join(root, "vitest.config.js") }, "skip"],
    ["no import.meta.main, no argv[1]", { main: undefined, argv1: undefined }, "skip"]
  ])("%s", (_name, input, expected) => {
    expect(entryDecision({ ...input, modulePath })).toBe(expected);
  });

  it("names the running version and the supported range", () => {
    const message = unsupportedNodeMessage("v22.11.0");
    expect(message).toContain("v22.11.0");
    expect(message).toContain("^22.22.2 || ^24.15.0 || >=26.0.0");
  });
});

describe("scheme-less --api-url", () => {
  it("fails without echoing the part before the colon", () => {
    const result = spawnSync(process.execPath, [modulePath, "--dev", "--api-url", "admin:hunter2@localhost:8000"], {
      cwd: root,
      encoding: "utf8"
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/http: or https:/);
    expect(result.stderr + result.stdout).not.toContain("admin");
  });
});
