// Builds the extension from source.
//
//   node scripts/build.js                         -> dist/extension/ (Load unpacked)
//   node scripts/build.js --zip                   -> dist/extension/ + dist/wwjc-extension-<version>.zip
//   node scripts/build.js --dev --api-url <url>   -> dist/dev-extension/ (never zipped)
//
// The release build copies an explicit allowlist of runtime files byte for
// byte. The dev build is the same except that the manifest's host_permissions
// and name, and the API_URL line in lib/request.js, point at a local backend.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unzipSync, zipSync } from "fflate";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Top-level runtime files. Every .js file directly in lib/ (not dotfiles,
// backups or other files) is added too.
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
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js") && !entry.name.startsWith("."))
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

// Reads the zip back from disk and throws unless its entries are exactly the
// runtime files, each byte-identical to its source.
function verifyZip(zipPath, root, files) {
  const entries = unzipSync(readFileSync(zipPath));
  const names = Object.keys(entries).sort();
  if (JSON.stringify(names) !== JSON.stringify(files)) {
    throw new Error(`zip entries ${JSON.stringify(names)} do not match the runtime files ${JSON.stringify(files)}`);
  }
  for (const file of files) {
    if (Buffer.compare(Buffer.from(entries[file]), readFileSync(join(root, file))) !== 0) {
      throw new Error(`zip entry ${file} differs from the source file`);
    }
  }
}

// Rebuilds the release build, then zips it to
// <distDir>/wwjc-extension-<manifest.version>.zip, removing any older zip, and
// verifies the written file. Returns the zip path. zip is injectable for tests.
export function packageZip({ root = ROOT, distDir = join(root, "dist"), zip = zipSync } = {}) {
  const outDir = build({ root, distDir });
  const files = listRuntimeFiles(root);
  const { version } = JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8"));
  const entries = {};
  for (const file of files) entries[file] = readFileSync(join(outDir, file));
  const zipped = zip(entries, { level: 9, mtime: ZIP_MTIME });

  for (const name of readdirSync(distDir)) {
    if (name.endsWith(".zip")) rmSync(join(distDir, name), { force: true });
  }
  const zipPath = join(distDir, `wwjc-extension-${version}.zip`);
  writeFileSync(zipPath, zipped);
  try {
    verifyZip(zipPath, root, files);
  } catch (err) {
    rmSync(zipPath, { force: true });
    throw err;
  }
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
    // The value is not echoed: it may contain credentials.
    throw new Error("--api-url is not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    // The scheme is not echoed: without one, the parsed "scheme" can be a
    // username (admin:pw@host).
    throw new Error("--api-url must be an http: or https: URL");
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
  // A replacer function, so $ patterns in the URL are written literally.
  const line = `export const API_URL = ${JSON.stringify(apiUrl.href)};`;
  return text.replace(API_URL_LINE, () => line);
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

// Names an unknown argument without echoing any value it carries, which may
// contain credentials: only the --flag part of --flag=value, and nothing of
// a non-flag argument.
function unknownArgumentMessage(arg) {
  const flag = /^--?[A-Za-z0-9][A-Za-z0-9-]*/.exec(arg)?.[0];
  return flag ? `Unknown argument: ${flag}` : "Unexpected argument (value not shown)";
}

export function parseArgs(argv) {
  const options = { zip: false, dev: false, apiUrl: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--zip") options.zip = true;
    else if (arg === "--dev") options.dev = true;
    else if (arg === "--api-url") options.apiUrl = argv[++i] ?? "";
    else if (arg.startsWith("--api-url=")) options.apiUrl = arg.slice("--api-url=".length);
    else throw new Error(unknownArgumentMessage(arg));
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

export const SUPPORTED_NODE = "^22.22.2 || ^24.15.0 || >=26.0.0";

export function unsupportedNodeMessage(version) {
  return `Unsupported Node.js version ${version}: requires ${SUPPORTED_NODE}`;
}

function realpathOrNull(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

// Decides what the module does at load time. import.meta.main (true only for
// the entry module, however it was named on the command line) settles it when
// present. Older Node lacks it, and npm only warns on engines, so there the
// module checks whether argv[1] (as given or with .js added) is this file
// and, if so, reports the Node version instead of silently doing nothing.
// Returns "run", "skip" or "unsupported".
export function entryDecision({ main, argv1, modulePath }) {
  if (main === true) return "run";
  if (main === false || !argv1) return "skip";
  const self = realpathOrNull(modulePath);
  const candidates = [argv1, `${argv1}.js`].map(realpathOrNull);
  return self && candidates.includes(self) ? "unsupported" : "skip";
}

const decision = entryDecision({
  main: import.meta.main,
  argv1: process.argv[1],
  modulePath: fileURLToPath(import.meta.url)
});
if (decision === "run") {
  process.exitCode = main(process.argv.slice(2));
} else if (decision === "unsupported") {
  console.error(`build failed: ${unsupportedNodeMessage(process.version)}`);
  process.exitCode = 1;
}
