# CLAUDE.md

## Project

WWJC is a Manifest V3 Chrome extension. Selecting text and choosing the
"What Would Jesus Comment?" context menu item sends the text to a backend
API; the result is shown in the toolbar popup. Plain JavaScript, no build step.

## Git exception

For the /work-issue workflow, `git commit` and `git push` are permitted only on
`issue-<N>-*` branches the run creates, never on `main`, and never as a
force-push. Granted by the repo owner on 2026-11-07.

## Tests

Run `npm ci` once, then `npm test` (vitest; popup tests use jsdom).
