# Contributing

## Branching

One long-lived branch, `main`, which is always releasable. Everything else is a
short-lived branch that exists only until its pull request is merged.

```
  feat/tray-menu ──┐
                   ├──▶ main ──▶ release PR ──▶ tag + release
  fix/exdev-copy ──┘              (release-please)
```

There is deliberately no `develop`, no `release/*` and no `hotfix/*`. Those
exist to answer "what is the next version, and what is in it" by hand, and
here release-please already answers it from the commit history — keeping both
would mean two sources of truth that drift. A fix for a released version is
made on `main` and released forward as the next patch.

**Branch names** carry the same prefix as the commit that will land:
`feat/…`, `fix/…`, `docs/…`, `refactor/…`, `perf/…`, `chore/…`, `ci/…`.

`release-please--branches--main` belongs to the bot. Don't branch from it,
don't push to it by hand.

## The loop

1. Branch off `main`.
2. Commit in Conventional Commit form — the `commit-msg` hook enforces it.
3. Open a pull request. **Its title is also a Conventional Commit**, because a
   squash merge turns the title into the commit message on `main`, and that
   message is what release-please reads. A workflow checks it.
4. Squash merge — or rebase, when every commit message on the branch earns
   its own line in the changelog. The branch is deleted either way.
5. release-please keeps one pull request open, titled `chore(main): release
   x.y.z`, with the changelog and every version bump in it. It updates itself
   on every merge to `main`. Ignore it until you want to ship.
6. Merge the release PR. That tags the commit, builds macOS, Windows and Linux
   bundles, attaches them to a draft release, and publishes it once they are
   all there.

Nothing releases on its own. A misconfiguration costs a pull request review,
never a bad release.

## Commit types, and what they do to the version

The project is pre-1.0, so a breaking change bumps the minor rather than the
major.

| Type | Changelog section | Version |
|---|---|---|
| `feat:` | Features | minor — `0.1.0` → `0.2.0` |
| `fix:` | Fixes | patch — `0.1.0` → `0.1.1` |
| `perf:` | Performance | patch |
| `refactor:` | Refactoring | patch |
| `docs:` | Documentation | patch |
| `build:` | Build | patch |
| `feat!:` or a `BREAKING CHANGE:` footer | ⚠ heading | minor, while < 1.0 |
| `test:` `ci:` `chore:` | hidden | none |

To release a specific version regardless, put `Release-As: 1.0.0` in a commit
body on `main`.

## Where the version lives

In four files, and release-please writes all four:

| File | How |
|---|---|
| `Cargo.toml` — `[workspace.package] version` | release-please, `toml` updater |
| `package.json` | release-please, `node` release type |
| `src-tauri/tauri.conf.json` | release-please, `json` updater |
| `Cargo.lock` — three workspace crates | `cargo update --workspace`, in the release workflow |

The member crates say `version.workspace = true` and inherit, so there is
exactly one Cargo version to write. Don't give a member its own literal
version — that would quietly reintroduce a second source of truth.

`Cargo.lock` is the odd one out because it is generated and cannot carry the
annotation comment release-please needs. The `lockfile` job in
`.github/workflows/release.yml` pushes the sync onto the release PR instead.

## Repository settings

These are not in the repository, so they have to be set once on GitHub. They
are what makes the model above hold rather than merely describe it.

```sh
# Squash and rebase, no merge commits. A squash takes the PR title and body
# rather than the list of work-in-progress commits — which is why the title is
# what has to be conventional. A rebase puts each commit on main as it stands,
# so take that route only when every message is one you would want in the
# changelog.
gh repo edit --enable-squash-merge \
             --enable-rebase-merge \
             --enable-merge-commit=false \
             --delete-branch-on-merge
gh api -X PATCH "repos/$REPO" \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY

# Step one: stop main being rewritten or deleted. This is what clears
# GitHub's "your main branch isn't protected" banner, and it costs
# nothing — direct pushes still work.
gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": null,
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON

# Step two, now that release-please runs under a personal access token
# (see below): require a pull request, and require CI to have passed.
gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Rust", "Frontend", "Conventional Commit"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0 },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
```

Neither call has been made yet — `main` answers `404 Branch not protected` and
there is no ruleset either. Nothing stands in the way any more: both used to
answer `403 Upgrade to GitHub Pro or make this repository public`, and the
repository is public.

**Step two's precondition is already met.** GitHub holds workflow runs on a
pull request authored by `app/github-actions` at `action_required` until
someone with write access approves them, and release-please force-pushes its
branch on every merge to main, so held runs pile up — six were waiting on
release PR #1. The action now runs under `RELEASE_PLEASE_TOKEN`, a fine-grained
PAT with Contents and Pull requests write, so the release pull request is
authored by a real account, the gate does not apply, and the required checks
report without anyone watching for them.

That secret is therefore load-bearing. If it expires the action falls back to
`github.token`, the held runs come back, and required checks would block a
release nobody can approve without noticing why. Clearing them by hand:

```sh
gh run list --json databaseId,conclusion \
  --jq '.[] | select(.conclusion=="action_required") | .databaseId' \
  | xargs -I{} gh api -X POST "repos/$REPO/actions/runs/{}/approve"
```

There is no repository-level API for the approval policy itself —
`actions/permissions/fork-pr-workflows` answers 404.

`enforce_admins` stays off so release-please can push its own branch, and the
review count is zero because there is no second reviewer on a solo project —
the gate here is CI, not a human. Raise it when there is someone to do them.

## Package managers

A release ends in two places besides the GitHub release: a Homebrew cask and a
winget manifest. Both are jobs in `release.yml` that run after `bundle`, and
both need a token this repository does not have by default. Until the secret
exists the job writes a warning and stops, so a release still succeeds — it
just publishes nowhere.

| Secret | What it is | Used by |
|---|---|---|
| `HOMEBREW_TAP_TOKEN` | a PAT with Contents write on `nimble-123/homebrew-tap` | the `Homebrew tap` job, to push the bumped cask |
| `WINGET_TOKEN` | a **classic** PAT with `public_repo` and `workflow` | `winget-releaser`, to open the manifest PR |

`WINGET_TOKEN` has to be classic: `winget-releaser` syncs the fork of
`microsoft/winget-pkgs` before it writes, and a fine-grained token cannot do
that across a repository it does not own.

The cask itself lives in [`nimble-123/homebrew-tap`](https://github.com/nimble-123/homebrew-tap),
because that is where Homebrew looks for it. The release job rewrites only its
`version` and `sha256` and reads both back before committing, so a `sed` that
matched nothing fails the job rather than leaving a cask pointing at the
previous build. **Its `zap` block must never list the metadata notes folder** —
that folder is the user's own, deliberately inside their vault, and
`brew uninstall --zap` would delete hand-written, tagged markdown.

The winget manifests live in `microsoft/winget-pkgs` and nowhere else. No copy
is kept here: `winget-releaser` reads the published installer and rewrites the
manifest from what it finds, so a template in this repository would only drift
from the real one. The first submission was made by hand —
[winget-pkgs#442854](https://github.com/microsoft/winget-pkgs/pull/442854) —
because the action can only bump a package the repository already knows.

Submitting a manifest by hand again, should it ever be needed:

```sh
# Fork microsoft/winget-pkgs once, then, per version, three files under
# manifests/n/nimble-123/skills-hub/<version>/ on a branch of the fork:
#   nimble-123.skills-hub.yaml             (version)
#   nimble-123.skills-hub.installer.yaml   (installer, sha256 of the .exe)
#   nimble-123.skills-hub.locale.en-US.yaml
gh pr create --repo microsoft/winget-pkgs --base master \
  --head nimble-123:<branch> \
  --title "New package: nimble-123.skills-hub version <version>"
```

Their moderators expect `winget validate` and `winget install` to have been run
on Windows. Say so plainly in the PR body when they have not been, rather than
ticking the boxes.

## Local setup

```sh
pnpm install
pnpm lefthook install     # pre-commit, pre-push and commit-msg hooks
cargo test --workspace
pnpm test
```

The hooks run the same checks CI does, on changed files only. See
`lefthook.yml`.
