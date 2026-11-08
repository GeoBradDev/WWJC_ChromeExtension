// Frozen regression tests for defects found in review of scripts/build.js.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { zipSync as realZip } from "fflate";
import { listRuntimeFiles, packageZip, parseApiUrl, rewriteApiUrl } from "../scripts/build.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const REQUEST_SOURCE =
  '// head\nexport const API_URL = "https://prod.test";\nexport const STORAGE_KEY = "k";\n';

let tmp;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "wwjc-defect-build-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("rewriteApiUrl with $ patterns in the URL", () => {
  it.each([
    ["http://localhost:8000/$&", 'export const API_URL = "http://localhost:8000/$&";'],
    ["http://localhost:8000/a$'b", 'export const API_URL = "http://localhost:8000/a$\'b";'],
    ["http://localhost:8000/?q=$$x", 'export const API_URL = "http://localhost:8000/?q=$$x";']
  ])("writes %s literally", (input, line) => {
    expect(rewriteApiUrl(REQUEST_SOURCE, parseApiUrl(input))).toBe(
      `// head\n${line}\nexport const STORAGE_KEY = "k";\n`
    );
  });
});

describe("runtime files in lib/", () => {
  it("ships only .js files, never dotfiles, backups or other files", () => {
    for (const f of ["manifest.json", "background.js", "popup.html", "popup.js", "icon.png", "lib/request.js",
      "lib/.DS_Store", "lib/.request.js.swp", "lib/request.js.orig", "lib/notes.txt"]) {
      mkdirSync(dirname(join(tmp, f)), { recursive: true });
      writeFileSync(join(tmp, f), f);
    }
    expect(listRuntimeFiles(tmp)).toEqual([
      "background.js",
      "icon.png",
      "lib/request.js",
      "manifest.json",
      "popup.html",
      "popup.js"
    ]);
  });
});

describe("package read-back check", () => {
  it("fails when the written zip does not hold exactly the runtime files", () => {
    // A zipper that drops one entry and adds another stands in for any
    // packaging fault; the package step must notice from the file on disk.
    const badZip = (entries, opts) => {
      const copy = { ...entries, "stray.txt": new Uint8Array([1]) };
      delete copy["popup.js"];
      return realZip(copy, opts);
    };
    expect(() => packageZip({ root, distDir: tmp, zip: badZip })).toThrow(/zip/i);
  });

  it("fails when a zipped entry's bytes differ from the source", () => {
    const badZip = (entries, opts) => realZip({ ...entries, "popup.js": new Uint8Array([0x2f, 0x2f]) }, opts);
    expect(() => packageZip({ root, distDir: tmp, zip: badZip })).toThrow(/popup\.js/);
  });
});

describe("parseApiUrl error messages", () => {
  it("does not echo credentials from an unparseable URL", () => {
    let message = "";
    try {
      parseApiUrl("http://user:s3cretpw@host:99999");
    } catch (err) {
      message = err.message;
    }
    expect(message).toMatch(/not a valid URL/);
    expect(message).not.toContain("s3cretpw");
  });

  it("does not echo credentials on the command line", () => {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "build.js"), "--dev", "--api-url", "http://user:s3cretpw@host:99999"],
      { cwd: root, encoding: "utf8" }
    );
    expect(result.status).toBe(1);
    expect(result.stderr + result.stdout).not.toContain("s3cretpw");
  });
});

describe("CLI entry through a symlinked path", () => {
  it("still runs main", () => {
    const link = join(tmp, "link");
    symlinkSync(root, link, "dir");
    const result = spawnSync(process.execPath, [join(link, "scripts", "build.js"), "--bogus"], {
      cwd: tmp,
      encoding: "utf8"
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--bogus/);
  });
});
