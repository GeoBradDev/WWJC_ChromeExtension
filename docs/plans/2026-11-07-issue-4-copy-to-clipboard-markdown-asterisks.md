# Plan: Copy to Clipboard inserts Markdown asterisks that show literally on most social platforms (issue #4)

Risk tier: Medium. Starts Low (popup only, no auth, money, permissions, or outward
messages) and rises one tier for each of: it alters existing behavior (the copied format
and the confirmation), and it is interaction in a real browser that jsdom cannot fully
exercise (the clipboard write under Chrome's user-activation and focus rules, and the
live-region announcement). The async rejection path is covered by unit tests, so it is
not counted again. Two files of code, one HTML file, one test file.

Domain skills:
- superpowers:test-driven-development: invoke (each behavior is written as a failing test
  first).
- chrome-devtools-mcp:a11y-debugging: not applicable because the live drive uses a scratch
  Puppeteer install against a throwaway profile, never the user's browser; the a11y
  properties (role, aria-live, no dialog) are asserted in unit tests and read back from
  the accessibility tree in the live drive.
- chrome-devtools-mcp:chrome-devtools, claude-in-chrome: not applicable for the same reason.
- frontend-design: not applicable because the change adds one status line under an
  existing button and reuses the existing `.status-error` style; no visual redesign.
- django, django-ninja, fastapi, expo, react: not applicable because the repo is a plain
  JavaScript MV3 extension with no framework.
- Payments or email skills: not applicable because nothing here touches either.

## Acceptance criteria

From the issue, made checkable:

1. AC1: The text written to the clipboard contains no Markdown characters. Concretely,
   for a result `{ reference, verse, explanation }` it is exactly
   `<reference>: "<verse>"` on line one and `<explanation>` on line two, joined by a
   single `\n`, with no `*`, `_` emphasis runs (`__`), or backtick characters anywhere,
   including any the backend itself put in a field. A test asserts the exact string for
   the issue's sample and asserts `/[*`]|__/` never matches, including for a result whose
   fields contain Markdown emphasis.
2. AC2: Copy success is shown inline without a modal dialog and is announced to screen
   readers. Concretely: `alert` is never called (it no longer appears in `popup.js`);
   after a successful write, the button label reads `Copied` and a status element that
   exists in the DOM from page load, with `role="status"` and `aria-live="polite"`, holds
   the text `Copied to clipboard.`; after `COPY_FEEDBACK_MS` (2000 ms) the button label
   returns to `Copy to Clipboard` and the status text is cleared.
3. AC3: Copy failure shows a visible error. Concretely: when
   `navigator.clipboard.writeText` rejects, or throws synchronously, or
   `navigator.clipboard` is undefined, the same status element is visible, carries the
   `status-error` class, and holds
   `Could not copy. Select the text above and copy it manually.`; the button label stays
   `Copy to Clipboard`; nothing is thrown unhandled. The error stays until the next copy
   attempt or the next render.
4. AC4: A new render (a new pending, done, or error record arriving while the popup is
   open) clears any copy feedback, so a `Copied` or error message never refers to an
   earlier result.
5. AC5: `npm test` passes.

Not done (chosen): the optional `text/html` plus `text/plain` `ClipboardItem` write. Plain
text satisfies every criterion, keeps one code path, and avoids a second permission and
browser-support surface. Noted as a follow-up option in the PR body.

## Files that change

- `lib/popup-view.js`:
  - Replace `formatForClipboard(result)` so it returns
    `` `${clean(result.reference)}: "${clean(result.verse)}"\n${clean(result.explanation)}` ``
    where `clean(s)` is `String(s ?? "").replace(/[*`]/g, "").replace(/__/g, "").trim()`.
    Update its comment.
  - Add `export const COPY_LABEL = "Copy to Clipboard"`, `COPIED_LABEL = "Copied"`,
    `COPIED_MESSAGE = "Copied to clipboard."`,
    `COPY_FAILED_MESSAGE = "Could not copy. Select the text above and copy it manually."`,
    `COPY_FEEDBACK_MS = 2000`.
  - Add `export function showCopyFeedback(state, { copyBtn, copyStatus })` with `state`
    one of `"idle" | "copied" | "failed"`: sets `copyBtn.textContent` (COPIED_LABEL for
    copied, COPY_LABEL otherwise), `copyStatus.textContent` (COPIED_MESSAGE, the failure
    message, or `""`), and toggles the `status-error` class on `copyStatus` (only for
    failed). Never hides `copyStatus` with `display:none`, so the live region stays in the
    accessibility tree and announcements fire.
  - Add `export async function copyResult(result, clipboard)`: returns `true` after
    `await clipboard.writeText(formatForClipboard(result))`, returns `false` if
    `clipboard` is missing or `writeText` throws or rejects. No DOM access, so it is
    unit-testable without the popup.
  - `renderRequest` is unchanged (the defect tests call it with a fixed element list that
    has no `copyStatus`).
- `popup.html`: add, right after the button,
  `<div id="copyStatus" class="copy-status" role="status" aria-live="polite"></div>`, and a
  `.copy-status { margin-top: 6px; font-size: 13px; min-height: 1em; }` rule. The existing
  `.status-error` rule supplies the error color.
- `popup.js`:
  - Add `copyStatus` to `elements`; import the new helpers.
  - In `render(record)`: clear the feedback timer and call `showCopyFeedback("idle", ...)`
    before `renderRequest`.
  - Click handler becomes async: return early unless `current?.status === "done"` with a
    result; clear the feedback timer; `showCopyFeedback("idle")` first (so a repeated
    message is re-announced); `const ok = await copyResult(current.result,
    navigator.clipboard)`; if the record changed during the await (`current` is not the
    record captured at click), do nothing; else show `copied` and set a timer for
    `COPY_FEEDBACK_MS` that returns to `idle`, or show `failed` with no timer.
  - Remove `alert`.
- `test/popup.test.js`:
  - Replace the two copy tests that assert the old Markdown format and `alert` (they
    encode the behavior this issue removes; they are not frozen defect tests and
    `.claude/fix-lock` does not exist) with tests for the new behavior, keeping the
    "copies only the newest result, once" intent with the new format.
  - New tests: exact plain format for the sample; no Markdown characters for a result
    with `**`, `*`, `__`, and backticks in its fields; ordinary punctuation survives
    unchanged (a field with colons, semicolons, straight and curly quotes, apostrophes,
    hyphens, a single underscore, and an internal line break comes through byte for byte,
    since only `*`, backticks, and `__` are removed, plus leading and trailing whitespace); success shows `Copied` plus the
    status text, `alert` stub never called, status element has `role="status"` and
    `aria-live="polite"` and is not `display:none`; after `COPY_FEEDBACK_MS` (fake timers)
    the label and status reset; rejection shows the failure message with `status-error`
    and the label stays; synchronous throw and missing `navigator.clipboard` likewise; a
    record change after a successful copy clears the feedback; `popup.js` source contains
    no `alert(`.
- `README.md`: the feature line becomes "One-click copy to clipboard as plain text, ready
  to paste into any reply box" (Phase 8 decides the exact words; the current line is not
  wrong, so this is optional).
- `docs/plans/2026-11-07-issue-4-copy-to-clipboard-markdown-asterisks.md`: this plan.

## Order of work

1. Write the failing tests in `test/popup.test.js` (format, feedback, failure, reset).
   Run `npm test`; record the red output. Commit
   `test: cover plain-text copy and inline copy feedback (issue 4)`.
   Freeze them with `.claude/fix-lock` listing `test/popup.test.js` while implementing.
2. Implement `lib/popup-view.js`, `popup.html`, `popup.js`. Run `npm test` green. Remove
   `.claude/fix-lock` (never committed). Commit
   `fix: copy plain text and show inline, announced copy status (issue 4)`.
3. Live drive (below).

## Risks

- Live region timing: setting text in a region inserted at the same moment is often not
  announced, which is why `copyStatus` is in the static HTML and only its text changes.
  Clearing to `""` before setting the message makes a repeated `Copied to clipboard.`
  announce again.
- Stale feedback: a slow `writeText` resolving after a new record arrived would show
  `Copied` against the new result. Guarded by comparing the captured record.
- Clipboard in an MV3 popup: `navigator.clipboard.writeText` needs a focused document and
  a user gesture; the popup has both on click, and no manifest permission is needed
  (`clipboardWrite` is only for `document.execCommand`). The live drive proves a real
  write.
- Stripping `*`, backticks, and `__` also removes them if they were meant literally in a
  verse or explanation. Scripture text and the explanation prose do not use them; accepted.
- Riskiest step: the live drive's clipboard read, which needs
  `clipboard-read`/`clipboard-sanitized-write` granted to the extension origin via CDP
  `Browser.grantPermissions`.

## Proof

- AC1: format tests in `test/popup.test.js` (exact string, no-Markdown regex).
- AC2: success feedback tests, `alert` never called, `role`/`aria-live` asserted, reset
  under fake timers, no `alert(` in `popup.js`.
- AC3: rejection, synchronous throw, and missing-clipboard tests.
- AC4: record-change-clears-feedback test.
- AC5: full `npm test`.

Live drive (tier Medium: drive the changed path; the failure path is also driven because
it is cheap). Puppeteer installed in a scratch directory outside the repo, never a project
dependency; Chrome at `/usr/bin/google-chrome` with a fresh scratch `--user-data-dir`;
the worktree extension loaded unmodified via `enableExtensions` plus
`browser.installExtension(path)`. No backend is contacted: storage is pre-seeded with a
`done` record from the extension's service worker target, using the issue's sample
`Matthew 22:39` result plus a field containing `**`. Then, on `popup.html` opened as a
tab (focused, via a real CDP mouse click on the button):
- Success: no `dialog` event fires; the button reads `Copied`; `#copyStatus` reads
  `Copied to clipboard.` and the accessibility snapshot shows it as a `status` live
  region; `navigator.clipboard.readText()` returns the exact plain string with no `*`,
  `__`, or backticks; after about 2 s the label is `Copy to Clipboard` again.
- Failure: deny the clipboard write in page (override `navigator.clipboard.writeText` to
  reject, done in the page via `evaluate`, never in a committed file), click, and show the
  visible red `Could not copy...` message and no dialog. Screenshots of both states saved
  to scratch.
