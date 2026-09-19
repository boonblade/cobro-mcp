# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [SemVer](https://semver.org/).

## [Unreleased]
### Added
- README: Quick start — the six steps from dev server to the first Send, with the sentence to type in the chat.

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
