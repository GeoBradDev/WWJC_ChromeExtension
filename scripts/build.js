// Builds the extension from source.
//
//   node scripts/build.js                         -> dist/extension/ (Load unpacked)
//   node scripts/build.js --zip                   -> dist/extension/ + dist/wwjc-extension-<version>.zip
//   node scripts/build.js --dev --api-url <url>   -> dist/dev-extension/ (never zipped)
//
// The release build copies an explicit allowlist of runtime files byte for
// byte. The dev build is the same except that the manifest's host_permissions
// and name, and the API_URL line in lib/request.js, point at a local backend.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Top-level runtime files. Every regular file directly in lib/ is added too.
const TOP_LEVEL_FILES = ["manifest.json", "background.js", "popup.html", "popup.js", "icon.png"];

// Fixed timestamp so the zip is the same bytes for the same sources. fflate
// writes the local date fields, so a local-time date gives the same entry
// timestamp in every time zone (a UTC date can fall in 1979, which zip
// cannot store).
const ZIP_MTIME = new Date(1980, 0, 1, 0, 0, 0);

const API_URL_LINE = /^export const API_URL = "[^"\n]*";$/gm;

// The sorted, slash-separated paths of the files the extension ships.
export function listRuntimeFiles(root = ROOT) {
  for (const file of TOP_LEVEL_FILES) {
    if (!isFile(join(root, file))) throw new Error(`Missing runtime file: ${file}`);
  }
  const lib = readdirSync(join(root, "lib"), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `lib/${entry.name}`);
  return [...TOP_LEVEL_FILES, ...lib].sort();
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function freshDir(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function copyRuntimeFiles(root, outDir, files) {
  for (const file of files) {
    mkdirSync(dirname(join(outDir, file)), { recursive: true });
    copyFileSync(join(root, file), join(outDir, file));
  }
}

// Writes the release build to <distDir>/extension and returns that path.
export function build({ root = ROOT, distDir = join(root, "dist") } = {}) {
  const outDir = join(distDir, "extension");
  const files = listRuntimeFiles(root);
  freshDir(outDir);
  copyRuntimeFiles(root, outDir, files);
  return outDir;
}

// Rebuilds the release build, then zips it to
// <distDir>/wwjc-extension-<manifest.version>.zip, removing any older zip.
// Returns the zip path.
export function packageZip({ root = ROOT, distDir = join(root, "dist") } = {}) {
  const outDir = build({ root, distDir });
  const files = listRuntimeFiles(root);
  const { version } = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const entries = {};
  for (const file of files) entries[file] = readFileSync(join(outDir, file));
  const zipped = zipSync(entries, { level: 9, mtime: ZIP_MTIME });

  for (const name of readdirSync(distDir)) {
    if (name.endsWith(".zip")) rmSync(join(distDir, name), { force: true });
  }
  const zipPath = join(distDir, `wwjc-extension-${version}.zip`);
  writeFileSync(zipPath, zipped);
  return zipPath;
}

// Validates a dev backend URL. Returns a URL or throws with a message for
// the command line.
export function parseApiUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("--api-url <url> is required for a dev build, e.g. --api-url http://localhost:8000");
  }
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(`--api-url is not a valid URL: ${value}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`--api-url must be an http: or https: URL, got ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error("--api-url must not contain a username or password");
  }
  return url;
}

// Returns a copy of the manifest pointed at the dev backend.
export function rewriteManifest(manifest, apiUrl) {
  return { ...manifest, name: `${manifest.name} (dev)`, host_permissions: [`${apiUrl.origin}/*`] };
}

// Replaces the single API_URL line of lib/request.js. Throws unless the line
// matches exactly once, so a refactor of request.js breaks the dev build
// instead of silently keeping the production URL.
export function rewriteApiUrl(text, apiUrl) {
  const matches = text.match(API_URL_LINE) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `lib/request.js must contain the line export const API_URL = "..."; exactly once (found ${matches.length})`
    );
  }
  return text.replace(API_URL_LINE, `export const API_URL = ${JSON.stringify(apiUrl.href)};`);
}

// Writes the dev build to <distDir>/dev-extension and returns that path.
export function buildDev({ root = ROOT, distDir = join(root, "dist"), apiUrl }) {
  const outDir = join(distDir, "dev-extension");
  const files = listRuntimeFiles(root);
  const manifest = rewriteManifest(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")), apiUrl);
  const request = rewriteApiUrl(readFileSync(join(root, "lib", "request.js"), "utf8"), apiUrl);

  freshDir(outDir);
  copyRuntimeFiles(root, outDir, files.filter((f) => f !== "manifest.json" && f !== "lib/request.js"));
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  mkdirSync(join(outDir, "lib"), { recursive: true });
  writeFileSync(join(outDir, "lib", "request.js"), request);
  return outDir;
}

export function parseArgs(argv) {
  const options = { zip: false, dev: false, apiUrl: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--zip") options.zip = true;
    else if (arg === "--dev") options.dev = true;
    else if (arg === "--api-url") options.apiUrl = argv[++i] ?? "";
    else if (arg.startsWith("--api-url=")) options.apiUrl = arg.slice("--api-url=".length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.zip && (options.dev || options.apiUrl !== undefined)) {
    throw new Error("--zip builds the release package and cannot be combined with --dev or --api-url");
  }
  if (options.apiUrl !== undefined && !options.dev) {
    throw new Error("--api-url is only allowed with --dev (use npm run build:dev -- --api-url <url>)");
  }
  return options;
}

export function main(argv) {
  try {
    const options = parseArgs(argv);
    if (options.dev) {
      const apiUrl = parseApiUrl(options.apiUrl);
      const out = buildDev({ apiUrl });
      console.log(`Dev build for ${apiUrl.href} written to ${out}`);
    } else if (options.zip) {
      console.log(`Package written to ${packageZip()}`);
    } else {
      console.log(`Build written to ${build()}`);
    }
    return 0;
  } catch (err) {
    console.error(`build failed: ${err.message}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
