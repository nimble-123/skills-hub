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
4. Squash merge. The branch is deleted.
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
# Squash merges only, and the squash commit takes the PR title and body —
# not the list of work-in-progress commits, which would end up in the changelog.
gh repo edit --enable-squash-merge \
             --enable-merge-commit=false \
             --enable-rebase-merge=false \
             --delete-branch-on-merge
gh api -X PATCH "repos/$REPO" \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY

# Step one, the moment the repository is public: stop main being rewritten or
# deleted. This is what clears GitHub's "your main branch isn't protected"
# banner, and it costs nothing — direct pushes still work.
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

# Step two, only once release-please runs under a personal access token
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

Both calls answer `403 Upgrade to GitHub Pro or make this repository public`
while the repository is private on the free plan. Branch protection and the
newer rulesets are gated the same way; there is no CLI route around it.

**Do not skip to step two.** GitHub holds workflow runs on a pull request
opened by `app/github-actions` at `action_required` until someone approves
them, so the checks on the release pull request never report — and a rule that
requires them would leave that pull request permanently unmergeable. Either
give release-please a personal access token (`token:` on the action, a
fine-grained PAT with Contents and Pull requests write), so the pull request is
authored by a real account and its checks run on their own, or leave step two
off.

`enforce_admins` stays off so release-please can push its own branch, and the
review count is zero because there is no second reviewer on a solo project —
the gate here is CI, not a human. Raise it when there is someone to do them.

## Local setup

```sh
pnpm install
pnpm lefthook install     # pre-commit, pre-push and commit-msg hooks
cargo test --workspace
pnpm test
```

The hooks run the same checks CI does, on changed files only. See
`lefthook.yml`.
