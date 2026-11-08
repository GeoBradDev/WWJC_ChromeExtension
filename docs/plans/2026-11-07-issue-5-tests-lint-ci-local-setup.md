# Plan: No tests, lint, CI, or local setup; backend missing from repo and endpoint hardcoded (issue #5)

Risk tier: High. The change adds the packaging pipeline that decides what ships, and the
dev build generates a manifest with different host_permissions, which touches permissions
(a force-High trigger). No runtime extension code changes. Medium would also be defensible.

Domain skills:
- superpowers:test-driven-development: invoke (build script tests written and seen red first).
- context7-plugin:docs: invoke for the ESLint 10 flat config and fflate zipSync APIs.
- chrome-devtools-mcp / claude-in-chrome: not applicable because the live drive loads the
  built directory in a throwaway Chrome profile via a scratch Puppeteer install, never the
  user's browser.
- frontend-design, django, django-ninja, fastapi, expo, react: not applicable, no UI or
  framework code changes.
- Payments or email skills: not applicable.

## Acceptance criteria

From the issue and its comment. Already met before this run (by #6): `npm test` exists
and passes; tests cover the context menu handler's success, backend error and network
failure paths and the popup's loading, error and result states (test/background.test.js,
test/request.test.js, test/popup.test.js).

1. AC1: `npm run lint` exists and passes locally. ESLint flat config (`eslint.config.js`),
   `@eslint/js` recommended, browser globals plus a readonly `chrome` global for extension
   sources, node globals for `scripts/` and config files, node plus browser globals for
   `test/` (changed during implementation: the jsdom popup tests use `document`,
   `DOMParser`, `getComputedStyle` and `alert`, and are frozen, so the config adapts). eslint, @eslint/js and
   globals are pinned exactly in package.json and locked in package-lock.json.
2. AC2: A GitHub Actions workflow runs `npm ci`, `npm run lint`, `npm test` on every
   pull request and on push to main. Actions are pinned to full commit SHAs with a
   version comment; the workflow sets `permissions: contents: read`; checkout uses
   `persist-credentials: false`.
3. AC3: The same workflow runs `npm run package` and uploads the resulting zip as an
   artifact.
4. AC4: The packaged zip contains only extension runtime files: manifest.json,
   background.js, popup.html, popup.js, lib/* and icon.png, with manifest.json at the zip
   root. No node_modules, tests, docs, config, dotfiles or .idea. Enforced by
   test/build.test.js and by the package command's read-back check (it reads the written
   zip from disk and fails unless the entries are exactly the runtime files, each
   byte-identical to its source); the CI `unzip -l` step is for visibility.
5. AC5: `npm run package` works locally (same command CI runs) and the shipped files are
   byte-identical to the sources; the packaged manifest is exactly the committed one.
6. AC6: The backend URL is configurable for local development without changing the
   shipped manifest or test/manifest.test.js (see Design). The committed manifest's
   host_permissions stay exactly the API_URL origin.
7. AC7: README documents dev setup (`npm ci`, `npm run lint`, `npm test`), "Load
   unpacked" from the built `dist/extension/` directory (not the repo root, which would
   bundle node_modules), the dev backend build, and the backend as an external HTTP
   service: the endpoint is `API_URL` in lib/request.js, contract POST JSON `{text}`,
   response `{raw:{reference, verse, explanation}}` or `{error}`. No invented repo link,
   hosting or privacy claims. The privacy section is unchanged. No new emojis or em dashes.
8. AC8: Root .gitignore ignores `.idea/`, `dist/`, `*.zip` (plus `.DS_Store`,
   `coverage/`); `.idea/` is untracked on this branch with `git rm -r --cached .idea`.

## Design

`scripts/build.js` (Node ESM), exporting pure, testable functions plus a CLI:

- `RUNTIME_FILES`: explicit allowlist: `manifest.json`, `background.js`, `popup.html`,
  `popup.js`, `icon.png`, plus every `.js` file directly in `lib/` that is not a dotfile
  (sorted). Changed after review from "every regular file in `lib/`", which would ship
  `lib/.DS_Store`, editor swap files and `.orig` backups; it now matches the `lib/*.js`
  scan in test/manifest.test.js.
- `npm run build`: `node scripts/build.js` removes and recreates `dist/extension/`, copying
  each runtime file byte for byte. This is the "Load unpacked" directory.
- `npm run package`: `node scripts/build.js --zip`: does the build, then writes
  `dist/wwjc-extension-<manifest.version>.zip` from `dist/extension/` with fflate
  `zipSync` (deterministic order, fixed mtime). Always rebuilds from source, so a dev
  build can never leak into the zip.
- `npm run build:dev -- --api-url http://localhost:8000`: writes `dist/dev-extension/`
  (a separate directory, never zipped). Same files, except:
  - `manifest.json`: `host_permissions` replaced with `[<dev origin>/*]`, `name` suffixed
    ` (dev)`; every other key unchanged.
  - `lib/request.js`: the single `export const API_URL = "...";` line replaced with the
    dev URL. The script fails if that line does not match exactly once, so a refactor of
    request.js breaks the dev build loudly instead of silently shipping the old URL.
  - `--api-url` must parse as an `http:` or `https:` URL with no username or password;
    anything else exits non-zero with a message. `--api-url` is rejected together with
    `--zip`.
  - Wiring (added during implementation): `build:dev` runs `node scripts/build.js --dev`,
    so `npm run build:dev` with no `--api-url` fails instead of silently doing a release
    build; `--api-url` without `--dev`, and `--dev` with `--zip`, are rejected too. The
    written API_URL is the parsed URL's `href` (a bare origin gains a trailing `/`).
  - Zip entry mtime is a fixed local-time 1980-01-01, because fflate writes local date
    fields and a UTC date falls in 1979 (unstorable) west of UTC. `npm run package` also
    deletes older `dist/*.zip` so `unzip -l dist/*.zip` sees exactly one archive.
- Nothing generated is committed: `dist/` is gitignored. test/manifest.test.js is not
  touched; it keeps guarding the committed manifest, which is the one that ships.

Zip library: fflate 0.8.3, pinned exactly (zero dependencies, released 2026-05-16).
Alternative if you prefer no new dependency: a ~60 line store/deflate zip
writer on `node:zlib` (`deflateRawSync`, `crc32`), at the cost of owning binary format code.

## Files that change

- `package.json`, `package-lock.json`: devDependencies eslint 10.13.0, @eslint/js 10.0.1,
  globals 17.13.0, fflate 0.8.3 (exact); scripts `lint`, `build`, `build:dev`, `package`;
  `engines.node` `^22.22.2 || ^24.15.0 || >=26.0.0` (changed after review from `>=22.12.0`, vitest 5.1.0's floor:
  jsdom 31.0.0 requires `^22.22.2 || ^24.15.0 || >=26.0.0` and eslint 10.13.0 requires `^22.13.0` or `>=24`; the
  jsdom range satisfies all of them).
- `eslint.config.js` (new).
- `scripts/build.js` (new).
- `test/build.test.js` (new).
- `.github/workflows/ci.yml` (new).
- `.gitignore`.
- `.idea/*` (untracked via `git rm -r --cached .idea`; files stay on disk).
- `README.md`: Tech Stack backend line made truthful, Demo section replaced with
  Development and Backend sections; privacy section untouched.
- `CLAUDE.md`: Tests section gains `npm run lint` and `npm run package`.
- Existing sources only where ESLint reports a real error, with no behavior change; any
  lint hit that reveals a real bug is reported, not fixed here.

## Order of work

1. Commit this plan alone.
2. Tests first: `test/build.test.js` covering file list, byte-identical release build,
   zip entry list (read back with fflate `unzipSync`), dev build rewrites (only
   host_permissions, name and the API_URL line differ), URL validation, the API_URL line
   match-exactly-once guard, and that every file referenced by manifest.json, popup.html
   (`src`/`href`) and every relative `import` in shipped JS is inside the allowlist. Run, see red.
3. `scripts/build.js` and package.json scripts until green.
4. ESLint: install, config, `lint` script, fix existing lint errors if any.
5. `.gitignore`, `git rm -r --cached .idea`.
6. CI workflow: checkout (persist-credentials false), setup-node (node 24, npm cache),
   `npm ci`, `npm run lint`, `npm test`, `npm run package`, `unzip -l dist/*.zip`,
   upload-artifact with `archive: false` and `if-no-files-found: error`.
   - actions/checkout 3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
   - actions/setup-node 949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
   - actions/upload-artifact cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
7. README and CLAUDE.md.

## Risks

- A future runtime file outside the allowlist would be missing from the zip: the
  reference-closure test catches files referenced from manifest, popup.html or imports.
- Dev build regex drift: guarded by the exactly-once check and a test.
- A dev build loaded alongside the release build: distinguished by the ` (dev)` name.
- Lint fixes in runtime code could change behavior: limited to no-op fixes, the full
  suite proves it.
- `git rm --cached .idea` deletes .idea from other clones on pull; the main checkout's
  local .idea edits are left alone (that happens on merge, by the user).

## Proof

- AC1: `npm run lint` output, exit 0.
- AC2, AC3: the CI run on the PR, green, with the artifact listed.
- AC4, AC5: test/build.test.js; `npm run package` then `unzip -l` output locally and in CI.
- AC6: test/build.test.js dev cases; test/manifest.test.js unchanged and green; live drive.
- AC7, AC8: README diff; `git ls-files .idea` empty.
- Live drive: load `dist/extension/` unpacked in a throwaway Chrome profile and confirm
  the service worker starts and the context menu registers; load `dist/dev-extension/`
  built with a local mock server URL and confirm a selection's request reaches the mock
  and the popup shows the result. Failure path: `build:dev` with `ftp://x` and with no
  URL exits non-zero.
