# Open

Running notes: what is decided, what is queued, what is only an idea. Not a
roadmap with dates. Closed items move out, not down — the history is in git.

---

## Waiting on a decision

### Code signing

- **macOS** — Apple Developer Program, 99 USD/year. Without it, macOS 15 no
  longer offers the right-click-Open bypass; the user has to go into System
  Settings. The secret names are already wired into `release.yml`, and
  `Info.plist` already carries the four usage-description strings. Two releases
  have shipped unsigned, so this is a question of how much friction the first
  launch should have, not a blocker.
- **Windows** — optional. winget accepts unsigned installers; SmartScreen will
  warn. Since 2023 certificates must live on hardware or in an HSM, so CI
  signing means a cloud service — Azure Trusted Signing, ~10 USD/month, is
  currently the cheapest. Check the eligibility rules before committing.

### Branch protection

Still nothing: `main` answers `404 Branch not protected` and there is no
ruleset either. Both things that blocked it are gone — the repository is
public, and the release pull request is authored by a real account, so its
checks report and can be required. The two calls, in the order they should be
made, are in `CONTRIBUTING.md`.

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

### Two secrets, and a pull request in someone else's queue

The tap and the winget manifest are built and submitted; what is left is not
work here.

- **`HOMEBREW_TAP_TOKEN`** — a PAT with Contents write on
  `nimble-123/homebrew-tap`. Without it the `Homebrew tap` job warns and stops,
  and the cask stays on whatever release it last saw.
- **`WINGET_TOKEN`** — a classic PAT with `public_repo` and `workflow`. Same
  shape of failure, no manifest pull request.
- **[winget-pkgs#442854](https://github.com/microsoft/winget-pkgs/pull/442854)**
  is open. Microsoft's bot wants the CLA accepted by a comment from the account
  that opened it, and their moderators review after that. `winget-releaser` can
  only bump a package the repository already knows, so nothing is automatic
  until this one is merged.

Two things the submitted manifest records that are worth revisiting:

- The v0.4.0 installer is per-user, so it went in as `Scope: user`. From the
  next release the NSIS bundle is `installMode: "both"`, which lets the user
  pick per-user or system-wide and asks for elevation to offer the choice.
  `komac`, inside `winget-releaser`, re-reads the installer on every bump, so
  the manifest should follow on its own — worth checking on the first bump
  rather than assuming.
- Add/Remove Programs shows the publisher as **nimble**, which is Tauri's
  default: the second element of `dev.nimble.skills-hub`. Setting
  `bundle.publisher` would fix it, and would then disagree with the 0.4.0 entry
  already submitted.

---

## Ideas

### Make the build faster

**Done for the expensive part.** `[profile.release]` is tuned for a shipped
binary — fat LTO, one codegen unit, optimised for size — and the bundle job
paid for that on every run although it only exists to prove packaging works. It
now overrides the three settings through `CARGO_PROFILE_RELEASE_*`; the release
workflow keeps the shipping profile. Same commit, warm cache:

| | shipping | CI profile | |
|---|---|---|---|
| Bundle (windows) | 366s | 269s | −27% |
| Bundle (ubuntu) | 295s | 218s | −26% |
| Bundle (macos) | 155s | 79s | −49% |
| Wall clock (they run in parallel) | 366s | 269s | −97s |

Weighted the way Actions bills a private repository, that was a 40% cut. The
repository is public now, so the billing argument is gone and only the wall
clock still counts.

**Still open, in order of expected payoff:**

1. `Swatinem/rust-cache` restore is 10–35s per job, and its save cost grows with
   the target directory. Two profile variants now compete for the repository's
   cache allowance, which shortens how long either survives.
2. A faster linker — `lld` on Windows and Linux, `mold` on Linux. Less
   interesting now that LTO is off for CI, which was most of the link cost.
3. The `Rust` job spends 67s of 128s on cache restore and `apt-get`, and the
   rest doing work. Little left to win, but the most lopsided job.
4. `sccache` — marginal while `rust-cache` already covers the dependencies.

### One shape for the chips

The tag chips on the cards and in the detail rail share `var(--radius-s)` since
#19. The filter chips above the grid and the count pills beside the headings
are still `999px`. They are controls rather than tags and nothing sits beside
them contradicting their shape, so this is a question rather than a bug.

---

## Unresolved

- **skills.sh** — whether the search endpoint has rate limits, and what
  attribution it expects. Neither is answerable from our own code. The client
  sends `User-Agent: skills-hub` and a 15s timeout.
