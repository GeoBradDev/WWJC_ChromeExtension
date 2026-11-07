# Plan: Manifest requests <all_urls> host access and unused activeTab (issue #2)

Risk tier: High. Forced High because the change edits the extension's permissions and host
access, which the skill's rules list as a force-High trigger (permissions or security). The
code change itself is small (one manifest edit plus one test file).

Domain skills:
- superpowers:test-driven-development: invoke (the manifest test is written and seen red first).
- chrome-devtools-mcp:chrome-devtools / claude-in-chrome: not applicable because the live
  drive uses a scratch Puppeteer install against a throwaway Chrome profile, never the
  user's browser.
- frontend-design: not applicable because no UI changes.
- django, django-ninja, fastapi, expo, react: not applicable because the repo is a plain
  JavaScript MV3 extension with no framework.
- Payments or email skills: not applicable because nothing here touches either.

## Acceptance criteria

From the issue, made checkable:

1. AC1: `manifest.json` `host_permissions` is exactly
   `["https://brad-stricherz--wwjd-bot-verse-api.modal.run/*"]`, that is, the origin of
   `API_URL` in `lib/request.js` followed by `/*`, and nothing else. No `<all_urls>`, no
   wildcard host.
2. AC2: `activeTab` is removed from `permissions`, and every remaining permission is used
   by code: `contextMenus` (background.js `chrome.contextMenus.create`/`onClicked`),
   `notifications` (lib/request.js `chrome.notifications.create`), `storage`
   (background.js, lib/request.js, popup.js `chrome.storage.*`). `chrome.action` and
   `chrome.runtime` need no permission. A unit test enforces that the manifest permission
   set equals the set of permission-gated `chrome.*` namespaces used in the shipped JS.
3. AC3: Chrome's permission warnings for the manifest no longer include "Read and change
   all your data on all websites". Proven by calling
   `chrome.management.getPermissionWarningsByManifest` (usable without the `management`
   permission) from an extension page in real Chrome, for both the old and new manifest,
   and recording both outputs.
4. AC4: The right-click to comment flow still works end to end in real Chrome with the
   narrowed manifest: a selection on a web page, the context menu click, the POST to the
   backend, the stored `done` record, the badge, the notification, and the popup showing
   reference, verse, and explanation. Proven against a local mock server only; the real
   Modal backend is never contacted.
5. AC5: `npm test` passes, including the new manifest test.

## Files that change

- `manifest.json`: replace `"<all_urls>"` with
  `"https://brad-stricherz--wwjd-bot-verse-api.modal.run/*"`; delete `"activeTab"`.
  Nothing else (version, name, other keys unchanged).
- `test/manifest.test.js` (new): reads `manifest.json` and the shipped JS
  (`background.js`, `popup.js`, every `lib/*.js`) as text.
  - Asserts `host_permissions` deep-equals `[new URL(API_URL).origin + "/*"]`, importing
    `API_URL` from `../lib/request.js`, so a future change to `API_URL` without the manifest
    (or the reverse) fails.
  - Asserts `permissions` contains no `activeTab` and no host patterns.
  - Scans the JS for `chrome.<namespace>` with a regex, keeps the namespaces that need a
    manifest permission using an explicit map in the test (`contextMenus`,
    `notifications`, `storage`, `scripting`, and similar gated namespaces; `action`
    and `runtime` are in an explicit no-permission allowlist). `tabs` is in neither list:
    most of `chrome.tabs` needs no permission and the `tabs` permission only exposes
    sensitive Tab fields, so any `chrome.tabs` use fails with the classify message and must
    be judged per usage. `activeTab` has no namespace
    of its own, so it is never derived from code and therefore never expected. It asserts
    the sorted derived set equals the sorted `permissions`. An unknown namespace found in code fails the test with a message to
    classify it, so the map cannot silently go stale.
  - Asserts `optional_host_permissions` and `optional_permissions` are absent or hold no
    host patterns, and every `content_scripts[].matches` entry (if any) is within the
    `API_URL` origin.
- `docs/plans/2026-11-07-issue-2-manifest-host-access-unused-activetab.md`: this plan.

No change to `background.js`: the unused `tab` argument mentioned in the issue was already
removed by PR #6 (`handleMenuClick(info)` at background.js:17).

## Order of work

1. Write `test/manifest.test.js`; run `npm test` and record that it fails on the current
   manifest for the expected reasons (`<all_urls>` and `activeTab`). Commit it alone as
   `test: assert manifest permissions match code usage (issue 2)` and freeze it via
   `.claude/fix-lock`.
2. Edit `manifest.json`; run `npm test` green; remove `.claude/fix-lock`. Commit
   `fix: narrow host access to the backend origin and drop activeTab (issue 2)`.
3. Live drive (below), recorded in the implementer's return and later the PR body.

## Risks

- The service worker fetch must still succeed. With the backend origin in
  `host_permissions`, the fetch is exempt from CORS for that origin exactly as before, so
  backend CORS headers are irrelevant. The live drive proves this with a mock that sends no
  CORS headers.
- Redirects: Modal web endpoints redirect long requests to the same host; a redirect to a
  different host would need that host too. Not observed in the code; noted, not handled.
- Removing permissions on an update does not re-prompt users, so no version bump is needed
  for install flow; the version is left unchanged (out of scope).
- The permission-usage test is a regex over source text. It is a guard, not a proof; a
  comment containing `chrome.tabs` would count as usage. Acceptable for a guard that errs
  toward requiring a permission be justified.
- Riskiest step: the live drive, because a localhost mock cannot be reached under the real
  manifest's narrowed host access (by design).

## Proof

- AC1, AC2, AC5: `test/manifest.test.js` red before the manifest edit, green after; full
  `npm test` green.
- AC3: live drive step A.
- AC4: live drive steps B and C.

Live drive (tier High: changed path plus failure and edge paths). Puppeteer installed in a
scratch directory outside the repo (never a project dependency), Chrome at
`/usr/bin/google-chrome`, a fresh `--user-data-dir` in scratch, headful on the existing
`DISPLAY` (or `--headless=new` if headful fails), extension loaded with Puppeteer's
`enableExtensions` launch option plus `browser.installExtension(path)` (CDP
`Extensions.loadUnpacked` over the pipe transport). Departure from the first draft, which
named `--load-extension` and `--disable-extensions-except`: branded Google Chrome 137 and
later ignore `--load-extension`, and the installed Chrome is 157.

- A. Permission warnings: load the real worktree extension (real manifest). From its
  `popup.html` page, call `chrome.management.getPermissionWarningsByManifest` with the
  text of the old manifest (`git show origin/main:manifest.json`) and of the new one.
  Expected: old includes "Read and change all your data on all websites"; new does not,
  and instead names only the Modal host, plus "Display notifications". Also read
  `chrome.permissions.getAll()` from the loaded extension: origins equals the Modal origin
  only, permissions has no `activeTab`. No network request to Modal is made in this step
  (the popup's own code only reads storage).
- B. End to end against a local mock: build a test-only copy of the extension in scratch
  whose only differences from the worktree are (1) `host_permissions` set to
  `http://127.0.0.1:<port>/*` and (2) `API_URL` in its `lib/request.js` set to that mock.
  Show the `diff -r` of copy versus worktree in the evidence to prove nothing else differs.
  The mock is a Node `http` server that returns `{ raw: { reference, verse, explanation } }`
  and sends no CORS headers, logging each request. Serve a local page with text, select it,
  and fire the context menu: preferred is a real right-click (CDP
  `Input.dispatchMouseEvent` with the right button on headful Chrome, then keyboard
  selection of the item if reachable); if the native menu cannot be driven, invoke the
  registered `chrome.contextMenus.onClicked` listener path from the service worker target
  via a test-only line in the copy's `background.js` that exposes `handleMenuClick` on
  `globalThis`, and say so in the evidence. Then show: the mock logged one POST with the
  selected text; storage `wwjcRequest` is `done` with the mock result; badge text is
  empty; the popup page renders reference, verse, and explanation.
- C. Failure and edge paths:
  - Host access is load-bearing and narrow: a second copy whose `host_permissions` names a
    different origin (for example `http://127.0.0.1:<other port>/*`) than the mock it calls.
    The fetch must fail on CORS and the record must end in `status: "error"` with the
    network message and badge `!`. This proves the extension no longer has access to
    origins outside `host_permissions`.
  - Backend error: mock returns HTTP 500; record ends `error`, badge `!`, popup shows the
    error.
  - Empty selection edge: handler called with whitespace-only `selectionText` makes no
    request (mock logs nothing).
- Cleanup: kill the Chrome and mock processes started (check `ps` first), delete the
  scratch profile. Never contact the real Modal backend in any step; the real-manifest
  extension in step A is never triggered to fetch.

### Frozen test rewrite

Approved by the orchestrator (the run's decision-maker). Reason: the test was written in
this PR and never on main; (a) fixes a check that would force an over-broad permission,
and (b) only tightens it.

- (a) Removed `tabs` from `GATED` and did not add it to `UNGATED`. Mapping `chrome.tabs`
  to the `tabs` permission would make a future `chrome.tabs.create(...)` demand `tabs`
  and add the "Read your browsing history" warning, although create, update, query,
  sendMessage, and onUpdated need no permission. Now any `chrome.tabs` use hits the
  "not classified" failure and is classified per usage.
- (b) New assertions: `optional_host_permissions` and `optional_permissions` contain no
  host patterns; every `content_scripts[].matches` entry is within the `API_URL` origin.
  Header note added that the regex scan's false negatives (bracket access,
  destructuring, aliasing) fail safe.

Proof the rewritten test still catches the defect, run in a scratch worktree at the
merge base `9b55a15` with only the rewritten test copied in:

```
× grants host access only to the API_URL origin
× does not request activeTab or host patterns in permissions
× requests exactly the permissions the shipped code uses
-   "https://brad-stricherz--wwjd-bot-verse-api.modal.run/*",
+   "<all_urls>",
AssertionError: expected [ 'contextMenus', 'activeTab', …(2) ] to not include 'activeTab'
Tests  3 failed | 2 passed (5)
```

Proof the new assertions bite: the fixed manifest plus
`"optional_host_permissions": ["<all_urls>"]` and a `content_scripts` entry with
`matches: ["<all_urls>"]`:

```
× does not request optional host access
× injects content scripts only within the API_URL origin
AssertionError: optional_host_permissions must not contain host patterns such as <all_urls>; ...
AssertionError: content_scripts matches <all_urls> reaches beyond https://brad-stricherz--wwjd-bot-verse-api.modal.run/*; ...
Tests  2 failed | 3 passed (5)
```

The manifest is unchanged by the rewrite, so no new live drive was run.
