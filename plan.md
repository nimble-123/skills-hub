# Open

Running notes: what is decided, what is queued, what is only an idea. Not a
roadmap with dates. Closed items move out, not down — the history is in git.

---

## Waiting on a decision

### Release PR #1 — merge it, and at what version?

`chore(main): release 0.2.0` is open and mergeable; all six checks pass,
including the bundle on all three platforms. Merging tags the commit, builds
macOS (universal), Windows and Linux, attaches the bundles to a draft release
and publishes it.

The version is still open. `0.2.0` is what release-please computed from the
history. If the first release should instead be `v0.1.0` — "everything built so
far, release one" — set `.release-please-manifest.json` to `0.0.0` and it
recalculates.

### Make the repository public

Unlocks three things at once: GitHub Pages starts deploying the product page by
itself (the workflow is already gated on visibility), branch protection becomes
available, and a Homebrew cask can fetch the DMG at all.

Classic protection *and* rulesets both answer `403 Upgrade to GitHub Pro or
make this repository public` while it is private on the free plan. The staged
commands are in `CONTRIBUTING.md`.

### Code signing

- **macOS** — Apple Developer Program, 99 USD/year. Without it, macOS 15 no
  longer offers the right-click-Open bypass; the user has to go into System
  Settings. The secret names are already wired into `release.yml`, and
  `Info.plist` already carries the four usage-description strings.
- **Windows** — optional. winget accepts unsigned installers; SmartScreen will
  warn. Since 2023 certificates must live on hardware or in an HSM, so CI
  signing means a cloud service — Azure Trusted Signing, ~10 USD/month, is
  currently the cheapest. Check the eligibility rules before committing.

---

## Queued

### Menubar companion (macOS)

Fully designed, nothing built. `tray-icon 0.25.1` is already in `Cargo.lock`;
only `features = ["tray-icon", "image-png"]` on the `tauri` dependency is
missing. Five pieces of work, three of them not obvious:

1. A monochrome template icon (16×16, 32×32) — the existing icons are colour
   app icons and will not do.
2. `ActivationPolicy::Accessory` when no window is open, `Regular` when one
   is. A fixed `LSUIElement` would hide the Dock icon even with a window open.
3. `CloseRequested` → `prevent_close()` + `hide()`, or the tray dies with the
   first window close.
4. **A headless scan.** `AppState.snapshot` is only ever filled by the
   frontend calling `rescan`, so a tray-only launch would have no data. Needs
   an `ensure_snapshot()`. `store` is also `None` until a notes folder is
   chosen, which the tray has to represent.
5. **An event back to the window.** `set_item_enabled` returns the updated item
   so the UI can patch one card. A tray toggling independently leaves an open
   window stale — needs `app.emit("item:changed", …)` and a listener in the
   store. The only part that touches the frontend.

Two shapes to choose between: a native `Menu` (no webview, text and checkmarks
only) or a popover with a webview (search and cards, ~50–80 MB RSS, and
`tauri-nspanel` + `tauri-plugin-positioner` for real menubar behaviour).
Native menu first — it covers the most valuable action, toggling without
opening the window, and the four items above are needed either way.

`tauri-nspanel` is the one dependency here whose maintenance state should be
checked before it goes in.

### Homebrew tap

Needs the repository public and at least one release. Own tap
(`nimble-123/homebrew-tap`), not homebrew-cask — the official repo has a
notability threshold a new project will not meet.

The cask's `zap` block must **not** list the metadata notes folder. That folder
is the user's own, deliberately inside their vault; `brew uninstall --zap`
would delete hand-written, tagged markdown.

### winget

Manifest in `microsoft/winget-pkgs`, submitted automatically by the
`winget-releaser` action. One change first: `"nsis": { "installMode": "both" }`
in `tauri.conf.json`, otherwise it only ever installs for the current user and
`Scope` cannot be stated honestly.

### Universal binary has never actually been built

`release.yml` passes `--target universal-apple-darwin`, but CI only ever builds
host-native. The first release run is also the first test of that line.

### Stop the release PR collecting held workflow runs

GitHub holds runs on a pull request authored by `app/github-actions` at
`action_required`, and release-please force-pushes its branch on every merge to
main, so a new pair appears each time — six had accumulated on PR #1, showing as
"2 workflows awaiting approval" on the pull request.

The real fix is a fine-grained PAT (Contents and Pull requests: write) passed to
the action as `token:`, so the pull request is authored by a real account and
the gate does not apply. There is no repository-level API for the approval
policy — `actions/permissions/fork-pr-workflows` answers 404.

This also unblocks step two of branch protection, which cannot require checks
that may never report. The by-hand approval command is in `CONTRIBUTING.md`.

---

## Ideas

### Make the build faster

**Done, and measured in CI.** `[profile.release]` is tuned for a shipped binary
— fat LTO, one codegen unit, optimised for size — and the bundle job paid for
that on every run although it only exists to prove packaging works. It now
overrides the three settings through `CARGO_PROFILE_RELEASE_*`; the release
workflow keeps the shipping profile.

Same commit, warm cache, before and after:

| | shipping | CI profile | |
|---|---|---|---|
| Bundle (windows) | 366s | 269s | −27% |
| Bundle (ubuntu) | 295s | 218s | −26% |
| Bundle (macos) | 155s | 79s | −49% |
| Wall clock (they run in parallel) | 366s | 269s | −97s |

Weighted the way Actions bills a private repository — Linux 1×, Windows 2×,
macOS 10× — that is 2577 → 1546, a 40% cut, because the most expensive leg is
the one that halved.

Turning LTO off makes a *cold* build worse: every dependency does full codegen
instead of emitting bitcode for one link-time pass, and Ubuntu went from ~283s
to 604s. It does not matter. Cold, Windows is the critical path at 971s (against
~1020s before), and Ubuntu runs alongside it. `lto = "thin"` was held in reserve
for the case where the warm numbers disappointed; they did not.

**Measurement discipline, learned the hard way:** the first local A/B compared
incremental rebuilds after touching `skills-core` and reported 71.7s → 14.9s.
That isolated exactly the case LTO-off wins — dependencies already built — and
said nothing about the cold build it made three times slower. Measure the
scenario you are actually changing.

**Still open, in order of expected payoff:**

1. `Swatinem/rust-cache` restore is 10–35s per job, and its save cost grows with
   the target directory. Two profile variants now compete for the repository's
   10 GB cache allowance, which shortens how long either survives.
2. A faster linker — `lld` on Windows and Linux, `mold` on Linux. Less
   interesting now that LTO is off for CI, which was most of the link cost.
3. The `Rust` job spends 67s of 128s on cache restore and `apt-get`, and the
   rest doing work. Little left to win, but the most lopsided job.
4. `sccache` — marginal while `rust-cache` already covers the dependencies.

### UI5 Web Components with React

An experiment, not a decision. `@ui5/webcomponents-react` 2.27.1 lists
`react: ^18 || ^19` as a peer dependency, so React 19 is supported — and React
19's custom-element handling is what makes wrapping web components workable at
all.

What has to be thought through before writing any code:

- **It collides with the existing design language.** `tokens.css` is a port of
  Obsidian's token set and every component is styled through it; UI5 brings
  Fiori theming (`sap_horizon`) and its own CSS custom properties. These are
  two theming systems, and the three-state light/dark handling in `theme.ts`
  is written against ours.
- **Size.** The dist is currently 12 MB after the shiki and lucide work.
  `@ui5/webcomponents` unpacks to 23 MB and the React wrapper to 5.6 MB before
  `-base`, `-fiori` and `-icons`. Tree-shaking decides whether that matters,
  but it has to be measured, not assumed.
- **Scope.** Whole-app replacement, or one screen as a spike on a branch?
- **What it would actually buy.** Worth naming before starting.

To be planned properly.

---

## Unresolved

- **skills.sh** — whether the search endpoint has rate limits, and what
  attribution it expects. Neither is answerable from our own code. The client
  sends `User-Agent: skills-hub` and a 15s timeout.
