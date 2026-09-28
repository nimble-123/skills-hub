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

### Menubar companion — what is left

Built, with a webview popover rather than a native menu: a status item, an
`NSPanel` holding a second webview, search over the whole library, and a switch
per row that moves the same file the window's card does. Either side emits
`item:changed` and the other patches one card, so the two cannot drift apart.

**Unverified: the focus behaviour on macOS 27.** `tauri-nspanel` has an open
report ([#123](https://github.com/ahkohd/tauri-nspanel/issues/123)) that a panel
takes focus like an ordinary window there. The maintainer says 2.1.0 with
`add_style_mask` fixes it; the reporter says it does not. This uses exactly that
call and it returned without error, which is the part that can be checked from a
terminal — the rest has to be looked at:

1. Open the popover from the menu bar while another application is in front.
2. Type in the search field.
3. `lsappinfo info -only name $(lsappinfo front)` — that other application
   should still be frontmost. If it says `skills-hub`, the panel is activating
   and the popover is pulling the user out of what they were doing.

If it does activate, the fallback is the native `Menu` the popover replaced:
fewer features, no focus to steal.

**Also not done:**

- Right-clicking the status item does nothing. The menu is deliberately not
  attached (`show_menu_on_left_click(false)` with no menu at all), because the
  popover carries the two actions a menu would have. Worth revisiting only if
  the popover turns out to be the slower path to Quit.
- No status item on Windows or Linux. `NSPanel` is what makes a webview behave
  like a menu bar item and there is nothing to port it to.
- The popover's empty state shows favourites. It was going to show recently
  changed items as well, and does not: `ItemMetadata` carries no timestamp for
  when an item last changed, and inventing one for this would be a change to
  the store rather than to the menubar.

### Two secrets, and a pull request in someone else's queue

The tap and the winget manifest are built and submitted; what is left is not
work here.

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
