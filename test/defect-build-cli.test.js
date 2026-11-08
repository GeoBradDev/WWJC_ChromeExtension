// Frozen regression tests for CLI defects in scripts/build.js found in the
// second review round.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function run(args, cwd = root) {
  return spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
}

describe("CLI entry without the .js extension", () => {
  it("runs main for node scripts/build from the repo root", () => {
    // --bogus fails argument parsing before anything is written.
    const result = run(["scripts/build", "--bogus"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--bogus/);
  });
});

describe("unknown arguments are not echoed", () => {
  it.each([
    [["--dev", "http://user:s3cret@localhost:8000"]],
    [["--dev", "--apiurl=http://user:s3cret@localhost:8000"]]
  ])("%j fails without printing the value", (args) => {
    const result = run([join(root, "scripts", "build.js"), ...args]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/argument/i);
    expect(result.stderr + result.stdout).not.toContain("s3cret");
  });

  it("names the flag of an unknown --flag=value", () => {
    const result = run([join(root, "scripts", "build.js"), "--apiurl=http://user:s3cret@localhost:8000"]);
    expect(result.stderr).toMatch(/--apiurl\b/);
  });
});
