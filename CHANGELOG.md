# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]
### Changed
- MCP instructions reorganized into 8 short lines (payload reading and ref/region conventions on separate lines); same rules, about 17% shorter.

## [0.9.2] — 2026-09-22
### Added
- MCP tool annotations (readOnlyHint / destructiveHint / idempotentHint / openWorldHint) on all six tools, so clients can tell which calls are safe to run unattended: wait is read-only, close is destructive, done and screenshot are not idempotent, open reaches the network.

### Changed
- Tool descriptions and argument hints are now in English (they were Korean).
- React: `react.source` now points at the picked element's own JSX line when that line is in your code. Previously it was the nearest component's call site — for elements written directly inside a page component (e.g. Next.js app router pages) that was the mount point or nothing. The component call site is still available as `react.callers[0]`.

### Fixed
- React: elements rendered by a component library (MUI, Radix, …) now resolve react.source to the JSX call site in your code instead of losing the location (React 19) or pointing into node_modules (React ≤18).
- React: when the element sits under a one-line pass-through wrapper you wrote around a library component, the payload now carries the call sites above it (`react.callers`, up to 2), so the agent isn't stranded on a file with nothing to change. Reported by u/QuanTradin on r/mcp, along with the component-library case above.
- React on Next.js (Turbopack): sectioned source maps are now resolved and `file://` sources are reported relative to the project root, so elements on app-router pages get a `react.source` (previously nothing).
- Next.js (Turbopack) dev servers are now detected as hot-reloading, so `done` no longer reloads the page.

## [0.9.1] — 2026-09-21
### Added
- Working indicator: while the agent is editing (from Send until done), the elements and regions you sent get a blue scanning outline and the toolbar shows a flowing line; respects prefers-reduced-motion.

## [0.9.0] — 2026-09-21
### Added
- Drag groups: dragging over two or more elements picks them as one group — the band becomes a region (ref "1") and the elements inside get "1a", "1b"…; the row is collapsed by default and expands to show or remove them. A band over one element picks just that element. Every element and region now carries a stable `ref` that does not change when other rows are removed.
- Narrow viewports: below 760px the strategy chip hides and the status line shrinks; below 520px the toolbar becomes a full-width bar with the status on its own line, and the panel and settings popover fill the width.

### Changed
- Toolbar: the status line has a fixed width (320px), so the toolbar no longer jumps as hints change; very long messages are cut at 160 characters (full text in the tooltip). Hover still scrolls the line to the end.
- Toolbar simplified: Select now opens the feedback panel (pick elements or just type a note) and closes it again; the collapse and note buttons are gone. Picked elements stay marked on the page while the panel is closed.
- Drafts without a note are dropped when the browser closes (close() or a fresh launch on the next open), so stale picks no longer come back. Drafts with a note still survive.
- A draft that has no elements, regions or note is no longer saved, so a refresh does not bring back an empty panel.

## [0.8.1] — 2026-09-21
### Changed
- README: changelog link, a drag hint for the toolbar and panel, and the demo GIF now shows the agent transcript alongside the browser.

## [0.8.0] — 2026-09-20
### Added
- Vue 3: picked elements now carry `vue: { component, source }` (SFC path) on dev builds, next to the existing React support. Framework detection is now an adapter list, so more frameworks can follow.

### Changed
- Feedback panel: tighter gap between the note box and the Send row.

### Fixed
- React 19: `react.source` (file:line) is back — recovered from the dev server's source maps via the fiber's debug stack. Production builds without source maps still report the component name only.

## [0.7.0] — 2026-09-20
### Added
- README: Quick start — the six steps from dev server to the first Send, with the sentence to type in the chat.
- Toolbar: drag it anywhere by the handle on its left. The position is not saved — it returns to the bottom center on reload.
- Picked elements are marked on the page with a numbered badge that matches the panel list; the note placeholder suggests "1: …, 2: …" when several are picked, and the agent is told notes may refer to elements by number.
- Drag a band over empty space to send that area as a region (page rect + enclosing element); the screenshot covers it and it gets a dashed numbered marker. Bands that contain elements behave as before.

### Changed
- Feedback panel: rows are cards with an accent number and a type chip (tag or "region"), a roomier note box, a "Sends selector · styles · shot · console" hint next to Send, and an ✕ in the header that collapses the panel (same as the toolbar button). The panel itself can be dragged by its header (there is a grip icon on the left); like the toolbar, the position is not saved.

## [0.6.1] — 2026-09-18
### Added
- README: demo GIF of the core loop (pick → note → Send → done) and a note that React 19 reports `react.component` without `source`.
### Changed
- `close` deletes screenshots of finished batches and the manual screenshot folder; manual screenshots are capped at 50 during a session.
### Fixed
- Light theme: the pick-mode hover badge (selector + size) rendered white-on-white; it now uses a dark text color.

## [0.6.0] — 2026-09-17
### Added
- README: `Payload` section — field rules and an example of what `wait` returns after Send.
- Settings popover (⚙) on the toolbar with theme selection: auto / dark / light / frost. Saved per user in `~/.cobro/settings.json`; `COBRO_THEME` pins it.
### Changed
- Toolbar: agent state is now a muted chip next to Select, with the agent's message as separate detail text — no more "Working: Working: …" duplication.
- Toolbar buttons are icons (Material Symbols); the label unfolds on hover/focus.
- Only the Select button unfolds its label on hover; ⚙ and Collapse stay icon-only (tooltips remain).
- The refresh strategy (none / reload / event) is shown as a second chip next to the agent state instead of trailing the hint text.
### Fixed
- Settings popover: unselected theme labels were invisible in dark mode; popover and panel now share one corner radius.
- The agent's done summary stays visible while it waits for the next request (it used to vanish the instant the agent called wait again).

## [0.5.0] — 2026-09-10
### Changed
- README is now English; the Korean version moved to `README.ko.md`.
- MCP `instructions`, server error messages and the Claude Code skill are now English. Overlay UI stays ko/en by browser language.
- `package.json` gained `description` and `keywords` for npm search.
### Added
- This changelog.

## [0.4.0] — 2026-09-10
### Changed
- Package and repository renamed `cobro-browser` → `cobro-mcp`. Register with `claude mcp add -s user cobro -- npx -y cobro-mcp@latest`. The old package is deprecated.
- Name origin: Cobro = co-browse. One slogan: "Meet Cobro: Your Co-Agent, Your Browser."

## [0.3.2] — 2026-09-09
### Changed
- Handshake: Send is enabled only while the agent is idle, waiting or done; the Unlock button is gone. The agent's `wait()` re-enables Send even if `done` was skipped.
- Operating protocol is delivered as MCP `instructions` at initialize — registration alone teaches the agent the loop. The skill file is optional.
### Fixed
- A profile held by another cobro process is reported as "profile in use" instead of "Chrome not found".
- The server exits when the host process dies (parent-PID watch), so no orphan browser blocks the next session.
- `close` cancels a pending `wait` before closing the browser.
- `dist/` is no longer tracked in git; it is built on publish.

## [0.3.0] — 2026-09-09
### Added
- First public release on npm under Apache-2.0.
### Changed
- Overlay reduced to the core loop: pick elements → note → Send → done. History, Add batch and Redo removed.

## [0.2.0] — 2026-09-09
### Added
- Toolbar status line that tells the user the next step, plus an agent status dot.
- Overlay hints and tooltips switch ko/en by `navigator.language`; long hints scroll once on hover.
### Changed
- Chromium sandbox enabled (one fallback with a console error).
### Fixed
- Send-path error handling, fixture install on Windows/Node 24 (`EINVAL`), stdio smoke assertions.

## [0.1.0] — 2026-09-08
### Added
- MCP server with six fixed tools: `open`, `wait`, `status`, `done`, `screenshot`, `close`.
- Page overlay (Shadow DOM), local WebSocket channel with token auth, per-project session state in `.cobro/`, shared browser profile.
- Refresh strategies `none` / `reload` / `event` with HMR auto-detection.
- WebKit and Firefox engines via `COBRO_BROWSER`.
