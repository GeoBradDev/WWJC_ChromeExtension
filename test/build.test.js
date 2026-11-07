// Tests for scripts/build.js: what the release build and zip ship, and how the
// dev build rewrites the backend URL without touching the committed sources.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { unzipSync } from "fflate";
import {
  listRuntimeFiles,
  build,
  buildDev,
  packageZip,
  parseApiUrl,
  parseArgs,
  rewriteManifest,
  rewriteApiUrl
} from "../scripts/build.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "scripts", "build.js");

// The runtime files of this repo, written out by hand: the release must ship
// exactly these and nothing else.
const EXPECTED_FILES = [
  "background.js",
  "icon.png",
  "lib/popup-view.js",
  "lib/request.js",
  "manifest.json",
  "popup.html",
  "popup.js"
];

const COMMITTED_API_LINE = 'export const API_URL = "https://brad-stricherz--wwjd-bot-verse-api.modal.run";';

let distDir;

beforeEach(() => {
  distDir = mkdtempSync(join(tmpdir(), "wwjc-build-test-"));
});

afterEach(() => {
  rmSync(distDir, { recursive: true, force: true });
});

function source(rel) {
  return readFileSync(join(root, rel));
}

function filesUnder(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...filesUnder(join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

function runCli(args) {
  return spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
}

describe("listRuntimeFiles", () => {
  it("lists exactly the extension runtime files of this repo", () => {
    expect(listRuntimeFiles(root)).toEqual(EXPECTED_FILES);
  });

  it("ignores everything outside the allowlist and non-files in lib", () => {
    const fake = mkdtempSync(join(tmpdir(), "wwjc-fake-root-"));
    try {
      for (const f of ["manifest.json", "background.js", "popup.html", "popup.js", "icon.png", "README.md",
        "package.json", ".gitignore", "lib/a.js", "lib/b.json", "node_modules/x/index.js", "test/t.test.js",
        ".idea/vcs.xml", "docs/plan.md", "lib/nested/c.js"]) {
        mkdirSync(dirname(join(fake, f)), { recursive: true });
        writeFileSync(join(fake, f), f);
      }
      expect(listRuntimeFiles(fake)).toEqual([
        "background.js",
        "icon.png",
        "lib/a.js",
        "lib/b.json",
        "manifest.json",
        "popup.html",
        "popup.js"
      ]);
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });

  it("fails when a required runtime file is missing", () => {
    const fake = mkdtempSync(join(tmpdir(), "wwjc-fake-root-"));
    try {
      for (const f of ["manifest.json", "background.js", "popup.html", "popup.js", "lib/a.js"]) {
        mkdirSync(dirname(join(fake, f)), { recursive: true });
        writeFileSync(join(fake, f), f);
      }
      expect(() => listRuntimeFiles(fake)).toThrow(/icon\.png/);
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });
});

describe("release build", () => {
  it("writes byte-identical copies of exactly the runtime files", () => {
    const out = build({ root, distDir });
    expect(out).toBe(join(distDir, "extension"));
    expect(filesUnder(out)).toEqual(EXPECTED_FILES);
    for (const f of EXPECTED_FILES) {
      expect(Buffer.compare(readFileSync(join(out, f)), source(f)), f).toBe(0);
    }
  });

  it("removes stale files from a previous build", () => {
    mkdirSync(join(distDir, "extension", "lib"), { recursive: true });
    writeFileSync(join(distDir, "extension", "stale.txt"), "old");
    writeFileSync(join(distDir, "extension", "lib", "old.js"), "old");
    const out = build({ root, distDir });
    expect(filesUnder(out)).toEqual(EXPECTED_FILES);
  });
});

describe("packageZip", () => {
  it("zips exactly the runtime files, byte-identical, manifest at the root", () => {
    const zipPath = packageZip({ root, distDir });
    expect(zipPath).toBe(join(distDir, "wwjc-extension-1.0.zip"));
    const entries = unzipSync(readFileSync(zipPath));
    expect(Object.keys(entries).sort()).toEqual(EXPECTED_FILES);
    for (const f of EXPECTED_FILES) {
      expect(Buffer.compare(Buffer.from(entries[f]), source(f)), f).toBe(0);
    }
    expect(JSON.parse(Buffer.from(entries["manifest.json"]).toString("utf8"))).toEqual(
      JSON.parse(source("manifest.json").toString("utf8"))
    );
  });

  it("is deterministic", () => {
    const first = readFileSync(packageZip({ root, distDir }));
    const second = readFileSync(packageZip({ root, distDir }));
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it("ships the committed manifest and API_URL even after a dev build", () => {
    buildDev({ root, distDir, apiUrl: parseApiUrl("http://127.0.0.1:8000") });
    const entries = unzipSync(readFileSync(packageZip({ root, distDir })));
    expect(Buffer.compare(Buffer.from(entries["manifest.json"]), source("manifest.json"))).toBe(0);
    expect(Buffer.compare(Buffer.from(entries["lib/request.js"]), source("lib/request.js"))).toBe(0);
    expect(Object.keys(entries).sort()).toEqual(EXPECTED_FILES);
  });

  it("leaves exactly one zip in the dist directory", () => {
    writeFileSync(join(distDir, "wwjc-extension-0.9.zip"), "old");
    packageZip({ root, distDir });
    expect(readdirSync(distDir).filter((f) => f.endsWith(".zip"))).toEqual(["wwjc-extension-1.0.zip"]);
  });
});

describe("parseApiUrl", () => {
  it.each([
    ["http://localhost:8000", "http://localhost:8000/", "http://localhost:8000"],
    ["https://example.test/api/verse", "https://example.test/api/verse", "https://example.test"],
    ["  http://127.0.0.1:9  ", "http://127.0.0.1:9/", "http://127.0.0.1:9"]
  ])("accepts %s", (input, href, origin) => {
    const url = parseApiUrl(input);
    expect(url.href).toBe(href);
    expect(url.origin).toBe(origin);
  });

  it.each([
    [undefined, /--api-url/],
    ["", /--api-url/],
    ["not a url", /not a valid URL/],
    ["ftp://x", /http: or https:/],
    ["file:///etc/passwd", /http: or https:/],
    ["javascript:alert(1)", /http: or https:/],
    ["http://user:pw@host", /username or password/],
    ["http://user@host", /username or password/]
  ])("rejects %s", (input, message) => {
    expect(() => parseApiUrl(input)).toThrow(message);
  });
});

describe("parseArgs", () => {
  it("reads --zip and --api-url in both forms", () => {
    expect(parseArgs([])).toEqual({ zip: false, dev: false, apiUrl: undefined });
    expect(parseArgs(["--zip"])).toEqual({ zip: true, dev: false, apiUrl: undefined });
    expect(parseArgs(["--dev", "--api-url", "http://a"])).toEqual({ zip: false, dev: true, apiUrl: "http://a" });
    expect(parseArgs(["--dev", "--api-url=http://a"])).toEqual({ zip: false, dev: true, apiUrl: "http://a" });
  });

  it("rejects --api-url together with --zip", () => {
    expect(() => parseArgs(["--zip", "--api-url", "http://a"])).toThrow(/--zip/);
  });

  it("rejects --api-url without --dev and unknown arguments", () => {
    expect(() => parseArgs(["--api-url", "http://a"])).toThrow(/--dev/);
    expect(() => parseArgs(["--bogus"])).toThrow(/--bogus/);
  });
});

describe("rewriteApiUrl", () => {
  it("replaces only the API_URL line", () => {
    const text = `// c\n${COMMITTED_API_LINE}\nexport const OTHER = 1;\n`;
    expect(rewriteApiUrl(text, parseApiUrl("http://127.0.0.1:8000"))).toBe(
      '// c\nexport const API_URL = "http://127.0.0.1:8000/";\nexport const OTHER = 1;\n'
    );
  });

  it("fails when the API_URL line is missing", () => {
    expect(() => rewriteApiUrl("export const API_URL = getUrl();\n", parseApiUrl("http://a"))).toThrow(
      /exactly once/
    );
  });

  it("fails when the API_URL line appears more than once", () => {
    const text = `${COMMITTED_API_LINE}\n${COMMITTED_API_LINE}\n`;
    expect(() => rewriteApiUrl(text, parseApiUrl("http://a"))).toThrow(/exactly once/);
  });
});

describe("rewriteManifest", () => {
  it("changes only host_permissions and the name", () => {
    const manifest = {
      name: "X",
      version: "1",
      permissions: ["storage"],
      host_permissions: ["https://prod.test/*"]
    };
    expect(rewriteManifest(manifest, parseApiUrl("http://127.0.0.1:8000/api"))).toEqual({
      name: "X (dev)",
      version: "1",
      permissions: ["storage"],
      host_permissions: ["http://127.0.0.1:8000/*"]
    });
    expect(manifest.host_permissions).toEqual(["https://prod.test/*"]);
  });
});

describe("dev build", () => {
  it("writes dist/dev-extension with only the manifest and API_URL line changed", () => {
    const out = buildDev({ root, distDir, apiUrl: parseApiUrl("http://127.0.0.1:8000") });
    expect(out).toBe(join(distDir, "dev-extension"));
    expect(filesUnder(out)).toEqual(EXPECTED_FILES);

    for (const f of EXPECTED_FILES.filter((f) => f !== "manifest.json" && f !== "lib/request.js")) {
      expect(Buffer.compare(readFileSync(join(out, f)), source(f)), f).toBe(0);
    }

    const committed = JSON.parse(source("manifest.json").toString("utf8"));
    const dev = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(dev.host_permissions).toEqual(["http://127.0.0.1:8000/*"]);
    expect(dev.name).toBe(`${committed.name} (dev)`);
    const strip = ({ host_permissions, name, ...rest }) => (void host_permissions, void name, rest);
    expect(strip(dev)).toEqual(strip(committed));

    const srcLines = source("lib/request.js").toString("utf8").split("\n");
    const devLines = readFileSync(join(out, "lib", "request.js"), "utf8").split("\n");
    expect(devLines.length).toBe(srcLines.length);
    const changed = srcLines.flatMap((line, i) => (line === devLines[i] ? [] : [i]));
    expect(changed.map((i) => srcLines[i])).toEqual([COMMITTED_API_LINE]);
    expect(changed.map((i) => devLines[i])).toEqual(['export const API_URL = "http://127.0.0.1:8000/";']);
  });

  it("does not touch the release build directory", () => {
    const release = build({ root, distDir });
    buildDev({ root, distDir, apiUrl: parseApiUrl("http://127.0.0.1:8000") });
    for (const f of EXPECTED_FILES) {
      expect(Buffer.compare(readFileSync(join(release, f)), source(f)), f).toBe(0);
    }
  });
});

describe("reference closure", () => {
  // Every file the shipped entry points reference must itself be shipped.
  function referencedFiles() {
    const refs = new Set();
    const manifest = JSON.parse(source("manifest.json").toString("utf8"));
    refs.add(manifest.background.service_worker);
    refs.add(manifest.action.default_popup);
    const icons = [manifest.action.default_icon, manifest.icons].flatMap((v) =>
      v == null ? [] : typeof v === "string" ? [v] : Object.values(v)
    );
    for (const icon of icons) refs.add(icon);

    const html = source("popup.html").toString("utf8");
    for (const m of html.matchAll(/\b(?:src|href)\s*=\s*"([^"]+)"/g)) {
      if (!/^[a-z]+:/i.test(m[1]) && !m[1].startsWith("#")) refs.add(posix.normalize(m[1]));
    }

    const queue = [...refs].filter((f) => f.endsWith(".js"));
    const seen = new Set();
    while (queue.length) {
      const file = queue.pop();
      if (seen.has(file)) continue;
      seen.add(file);
      if (!existsSync(join(root, file))) continue;
      const text = source(file).toString("utf8");
      for (const m of text.matchAll(/\bfrom\s+["'](\.[^"']+)["']|\bimport\s*\(\s*["'](\.[^"']+)["']/g)) {
        const target = posix.normalize(posix.join(posix.dirname(file), m[1] ?? m[2]));
        refs.add(target);
        queue.push(target);
      }
    }
    return [...refs].sort();
  }

  it("ships every file referenced from manifest.json, popup.html and imports", () => {
    const shipped = new Set(listRuntimeFiles(root));
    const refs = referencedFiles();
    expect(refs).toContain("lib/request.js");
    expect(refs).toContain("lib/popup-view.js");
    for (const ref of refs) expect(shipped.has(ref), `${ref} is referenced but not shipped`).toBe(true);
  });
});

describe("CLI", () => {
  it.each([
    [["--dev"], /--api-url/],
    [["--dev", "--api-url", "ftp://x"], /http: or https:/],
    [["--dev", "--api-url", "http://user:pw@host"], /username or password/],
    [["--dev", "--api-url", "http://127.0.0.1:8000", "--zip"], /--zip/],
    [["--api-url", "http://127.0.0.1:8000"], /--dev/]
  ])("exits non-zero for %j", (args, message) => {
    const result = runCli(args);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(message);
  });
});
