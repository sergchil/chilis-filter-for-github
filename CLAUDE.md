# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Chili's Filter for GitHub: a Manifest V3 Chrome extension that hides generated code, lock files and snapshots from GitHub pull request diffs. Plain JavaScript, no build step, no dependencies, no tests, no linter.

## Run and release

- Run: `chrome://extensions` → Developer mode → Load unpacked → this folder. After edits, click reload on the extension card and reload the GitHub tab (old tabs keep the stale content script; it retires itself, see below).
- Automated check in a real browser: Playwright's bundled Chromium with `launchPersistentContext(..., { channel: 'chromium', args: ['--disable-extensions-except=<repo>', '--load-extension=<repo>'] })`. Branded Google Chrome ignores `--load-extension`. Public PRs work signed out, but signed out GitHub serves the classic PR UI only; the new UI needs a signed-in session.
- Release: bump `version` in `manifest.json`, commit, `git tag vX.Y.Z && git push origin master vX.Y.Z`. `.github/workflows/publish.yml` fails if the tag and manifest version differ, then attaches a zip to a GitHub Release. The Chrome Web Store upload is manual.
- The release zip contains only `manifest.json *.js *.css options.html icons`. A new top-level file the extension needs must be added to that `zip` line.

## Architecture

Script load order matters, because files share globals instead of modules:

- `shared.js`: loaded first by both the content script and the options page. Storage keys, built-in noise pattern lists per language, default groups and shortcuts, the pattern compiler (`ghxCompilePattern`), and `ghxLoadConfig()`. Everything global is `GHX_`/`ghx`-prefixed.
- `content.js`: runs on `https://github.com/*`, wrapped in one IIFE. It finds per-file diff containers and file tree items, hides matches with the `ghx-hidden` class, and mounts a funnel button after GitHub's "Filter files…" input. If the sidebar is collapsed it shows a floating button instead. The dropdown menu is attached to `<body>` so the sidebar can't clip it. A `MutationObserver` with a 200 ms debounce re-applies filters as GitHub loads diffs progressively.
- `options.html` + `options.js`: the settings page. Draft/saved state with a save bar, a pattern editor with syntax highlighting, and a "Copy AI prompt" builder. `theme.js` (loaded in `<head>` before paint) sets `data-style`/`data-mode` on `<html>` for the 3 themes × light/dark. `liquid.js` draws the WebGL backdrop for the Liquid theme.
- `background.js`: only opens the options page (toolbar click, or a `ghx-open-options` message from the menu).

Contracts that span files:

- Storage split: shortcuts and groups live in `chrome.storage.sync`; which shortcuts are switched on (`ghxActive`) lives in `chrome.storage.local`; the theme lives in `localStorage` (read synchronously, no flash) and is mirrored to sync. The content script and options page stay in sync through `chrome.storage.onChanged`.
- Adding a new built-in shortcut or group: add it to the defaults in `shared.js` **and** bump `GHX_SEED_VERSION`. Otherwise existing users who have already saved never get it (`ghxLoadConfig` merges missing defaults by id only when the stored seed is older).
- Pattern semantics (also documented in README): no `/` → matches the start or end of the file name; contains `/` → substring of the path; `*`/`?` → glob (`*` stays inside one folder, `**` crosses folders); `#` lines are comments; `,` also separates. Hide (`exclude`) always beats Show only (`include`).
- GitHub DOM support: `findDiffs()` and `treeItemPath()` handle both the classic PR UI and the new React UI. In the classic UI each `div.file` sits inside `copilot-diff-entry`; only the innermost container is counted, and the wrapper is hidden with it. When files carry `data-tagsearch-path`, a `div.file` without it is a code preview, not a changed file. Check `lastHiddenCount` against GitHub's "Files changed" count after any change here.
- Extension reload: `alive()`/`guard()`/`retire()` in `content.js` detect a dead `chrome.runtime` in open tabs and remove the UI quietly instead of throwing. Wrap new event handlers that call `chrome.*` in `guard()`.

## Style

One-line comments that say why, as in the existing code. The extension makes no network requests and asks only for the `storage` permission. The README privacy section and the Chrome Web Store listing depend on that, so keep it that way.
