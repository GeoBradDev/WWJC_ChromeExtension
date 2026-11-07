# Plan: Comment requests can be lost, falsely reported as ready, or show a stale result (issue #1)

Risk tier: High. Starts Low, raised once each for stateful popup UI a unit test cannot fully
exercise (live update while open), altering existing behavior, async request handling with
a service worker lifecycle concern, and touching most of the repo's files; capped at High.
No force-High trigger applies (no auth, payments, migrations, or outward messages).

Domain skills:
- superpowers:test-driven-development: invoke (every behavior below is test-first).
- chrome-devtools-mcp:chrome-devtools / claude-in-chrome: invoke for the live drive only if
  the scripted Chrome launch below is not workable.
- frontend-design: not applicable because the popup keeps its current look; only states change.
- django, django-ninja, fastapi, expo, react: not applicable because the repo is a plain
  JavaScript MV3 extension with no framework.
- Payments or email skills: not applicable because nothing here touches either.

## Acceptance criteria

From the issue, made checkable:

1. AC1 (slow request): a request whose mock endpoint responds after 45s ends in
   `status: "done"` with the result stored and the "ready" notification shown. Proven with
   fake timers in unit tests, and the service worker is actively kept alive for the whole
   request (keepalive calls observed every interval until the request settles, and stopped
   after).
2. AC2 (errors): each of these ends in `status: "error"`, an error notification, an error
   state in the popup, and never the "Your comment is ready" message: network failure
   (fetch rejects), non-2xx status, 2xx body that is not JSON, 2xx JSON with an `error`
   field, and 2xx JSON missing any of `raw.reference`, `raw.verse`, `raw.explanation`
   (each must be a non-empty string).
3. AC3 (no stale result): starting a request writes a `pending` record that replaces any
   previous record before `fetch` is called, so a later failure can never leave an earlier
   result displayed as current. A response for a superseded request (an older request that
   settles after a newer one started) is discarded and does not overwrite the newer record
   or notify.
4. AC4 (loading state): a popup opened during a request shows a loading state with the
   selected text, and updates to the result or error via `chrome.storage.onChanged`
   without reopening.
5. AC5 (tests): unit tests cover success, error (network, non-2xx, backend `error` field),
   malformed (non-JSON, missing fields), and timeout paths, and run with `npm test`.

Additional behavior in scope (from the issue's recommended fix):
- Timeout: an `AbortController` aborts the fetch after 90s and stores a "the service is
  warming up or slow, please try again" error.
- Immediate feedback on click: `chrome.action.setBadgeText` shows "..." while pending,
  cleared on done, "!" on error. No permission needed.
- Startup recovery: if the worker starts and finds a `pending` record older than the
  timeout plus a margin (worker was killed mid-request), it marks it `error` with a
  "request was interrupted, try again" message, so the popup never spins forever.
- Popup shows the selected text (truncated with CSS) so the user can confirm which post
  the comment belongs to.

## Design

Storage: a single key `wwjcRequest` holding
`{ id, status: "pending" | "done" | "error", selectedText, result, error, updatedAt }`.
`result` is `{ reference, verse, explanation }` only when done; `error` is a user-facing
string only when error. The old `wwjcResponse` key is removed on install/startup
(`chrome.storage.local.remove`) so no old result can render.

Keepalive choice: periodic trivial extension API call (`chrome.runtime.getPlatformInfo`)
every 20s while a request is in flight, cleared in `finally`. Justification from Chrome's
service worker lifecycle doc
(https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle):
"Receiving an event or calling an extension API resets this timer" (Chrome 110+) for the
30s idle timer, and a single request may run up to 5 minutes, which a 90s timeout stays
under. Chosen over an offscreen document because the `offscreen` API requires a declared
reason from a fixed list (audio, DOM parsing, clipboard, workers, and so on) and none
describes a network request; claiming an unrelated reason is a Chrome Web Store review
risk, and it would add a permission and a second message hop. The doc also lists "a fetch()
response takes more than 30 seconds to arrive" as a termination condition without saying
whether API calls suspend it, so the live drive below must prove a 45s response survives in
real Chrome. If it does not, stop and report BLOCKED with the offscreen document as the
proposed fallback (requires adding the `offscreen` permission). Startup recovery covers the
remaining case where the worker is killed anyway.

## Files that change

- `lib/request.js` (new, ES module): pure request logic with injected dependencies, no
  `chrome` global access at import time. Exports `STORAGE_KEY`, `REQUEST_TIMEOUT_MS`
  (90000), `KEEPALIVE_INTERVAL_MS` (20000), `API_URL` (moved from background.js unchanged),
  `parseResult(response)` (validates and returns `{ ok, result | error }`),
  `runCommentRequest(selectedText, deps)` (writes pending, fetches with timeout and
  keepalive, validates, writes done or error only if the stored record's id still matches,
  sets badge, creates notification), `recoverStaleRequest(deps)`.
- `background.js`: becomes a thin ES module that imports `lib/request.js` and wires
  `onInstalled` (context menu, remove legacy key), `onStartup` and module load (stale
  recovery), and `contextMenus.onClicked` (calls `runCommentRequest`). Keep the context menu
  id, title, and contexts unchanged. Remove the module-load `console.log` only if it gets in
  the way; otherwise keep it.
- `manifest.json`: add `"type": "module"` to `background`. No permission changes (`action`
  badge needs none; `offscreen` is not added unless the live drive forces the fallback).
- `lib/popup-view.js` (new, ES module): `renderRequest(record, elements)` that sets the
  DOM for none, pending, done, error; exported so jsdom tests can call it.
- `popup.js`: becomes an ES module. On `DOMContentLoaded`, reads `wwjcRequest`, renders,
  and subscribes to `chrome.storage.onChanged` for `local` area `wwjcRequest`, re-rendering
  on change. Copy button: keep exactly the current behavior (same text format
  `**ref**\n*verse*\n explanation` as today, `navigator.clipboard.writeText` then
  `alert("Copied to clipboard!")`), but attach the click handler once and read the current
  record at click time so it never copies a stale result. Replace the emoji string with
  plain text.
- `popup.html`: `<script type="module" src="popup.js">`; add `#selectedText` and `#status`
  elements; keep existing ids (`loading`, `reference`, `verse`, `explanation`, `copyBtn`).
  Keep existing styles; add minimal styles for the selected text and error text.
- `package.json` (new): `"type": "module"`, `"private": true`, scripts `"test": "vitest run"`,
  devDependencies `vitest` and `jsdom` pinned to exact current versions. Commit
  `package-lock.json`.
- `vitest.config.js` (new): default node environment; popup tests opt into jsdom with a
  per-file `// @vitest-environment jsdom` comment.
- `test/chrome-mock.js` (new): hand-written `chrome` mock factory: in-memory
  `storage.local` (get, set, remove, promise style) that fires `storage.onChanged`
  listeners, `notifications.create`, `action.setBadgeText`, `runtime.getPlatformInfo`,
  `contextMenus.create`, listener registries for `onInstalled`, `onStartup`, `onClicked`.
- `test/request.test.js`, `test/background.test.js`, `test/popup.test.js` (new).
- `.gitignore` (new): `node_modules/` only.
- `CLAUDE.md`: add the test command (`npm test`) once it exists.

Not changed: `README.md` (setup docs are issue #5), manifest permissions or host
permissions (issue #2), privacy disclosure (issue #3), clipboard approach (issue #4).

## Order of work

1. Test setup: `package.json`, lockfile, `vitest.config.js`, `.gitignore`,
   `test/chrome-mock.js`, a trivial smoke test proving the mock works. Commit.
2. `parseResult` test-first: success, non-2xx, non-JSON, `error` field, each missing or
   empty field. Commit red tests then the implementation (or together if the repo has no
   frozen-test hook, with red output recorded in the commit message body).
3. `runCommentRequest` test-first with fake timers and a mock `fetch`: pending written
   before fetch is called; success path stores done and notifies "ready"; each error path
   stores error and notifies error, never "ready"; 45s slow response completes and
   keepalive is called at 20s and 40s and stops after; 90s timeout aborts and stores the
   timeout message; superseded request is discarded; badge transitions. Commit.
4. `recoverStaleRequest` test-first. Commit.
5. `background.js` wiring and manifest `type: module`, with `test/background.test.js`
   importing background.js against the chrome mock and asserting listeners are registered
   and a click runs the flow end to end. Commit.
6. `lib/popup-view.js`, `popup.js`, `popup.html` test-first in jsdom: renders none, pending
   (with selected text), done, error; live update via `onChanged` from pending to done
   without reload; error after a previous success never shows the old verse; copy button
   copies the current result with the existing format. Commit.
7. `CLAUDE.md` test command line. Full gate. Live drive. Commit.

## Risks

- Riskiest step: whether a 45s `fetch` survives in real Chrome with API-call keepalive. The
  live drive is the proof; fallback is the offscreen document (BLOCKED for approval).
- `background.type: module` requires static imports only (no dynamic `import()` in a
  service worker). Listeners must be registered synchronously at top level so events wake
  the worker correctly.
- Loading unpacked from the repo root after `npm install`: Chrome refuses an extension
  containing files or directories whose names start with `_`. If anything under
  `node_modules` does, the live drive loads a copy of only the extension files and the
  finding is reported for issue #5 (packaging). Do not restructure the repo for it here.
- Branded Chrome 137+ ignores `--load-extension`. The live drive must load the extension
  another way (for example Puppeteer or CDP `Extensions.loadUnpacked` with
  `--remote-debugging-pipe --enable-unsafe-extension-debugging`, or Chrome for Testing).
- An attached DevTools session keeps the service worker alive, which would make the 45s
  live drive pass vacuously. The drive must not keep DevTools attached to the worker while
  waiting; observe the outcome through storage or the popup afterwards.
- Changing the storage key orphans `wwjcResponse`; it is removed on install and startup.

What I chose not to do: offscreen document (see Design), retries, backend changes
(non-2xx from the backend is the backend repo's job), notification click handlers,
popup visual redesign.

## Proof

| Criterion | Proof |
| --- | --- |
| AC1 | `request.test.js`: mock fetch resolving at 45s with fake timers ends `done`, "ready" notification, `getPlatformInfo` called at least twice during the wait and not after. Live drive: real Chrome, local mock server delaying 45s, worker not held by DevTools, result stored and shown in the popup. |
| AC2 | `request.test.js`: one test per error kind asserting `status: "error"`, error notification text, and that no notification contains "ready". `popup.test.js`: error record renders the error and hides the verse and copy button. |
| AC3 | `request.test.js`: pending record written (old result gone) before fetch is invoked; superseded request discarded. `popup.test.js`: previous done then error record shows only the error. |
| AC4 | `popup.test.js`: pending record shows loading and selected text; firing `onChanged` with a done record updates the DOM without re-running init. Live drive: open the popup page during the 45s request and see it switch to the result. |
| AC5 | `npm test` output listing the success, error, malformed, and timeout tests. |

Live drive must show: (a) 45s success path end to end, (b) a non-2xx or `{"error": ...}`
response giving the error notification and popup error, (c) a success followed by a failure
not showing the old verse, (d) an open popup updating from loading to result.
