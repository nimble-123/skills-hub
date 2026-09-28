---
name: verify-tree
description: Regenerate every generated file and prove the working tree is consistent with its sources. Use before opening a pull request, after changing a generator's input, or whenever a claim needs evidence rather than assertion.
disable-model-invocation: true
---

# Proving the tree is consistent

Four files in this repository are written by generators, and each has a source
that can change without it. This regenerates all of them and then asks git
whether anything moved. A clean diff is the evidence; anything else is a finding.

Run from the repository root.

```sh
pnpm icons
pnpm fonts
cargo test -p skills-hub export_typescript_bindings

git diff --exit-code \
  src/bindings.ts \
  src/components/common/icons.ts \
  src/styles/fonts.css \
  src/fonts/
```

`git diff --exit-code` prints nothing and exits 0 when the committed output
already matches its source. A non-empty diff means a generator's input was
changed without the output being regenerated — commit what it just produced.

Then the checks themselves:

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm test
pnpm typecheck
pnpm check
```

## When the interface changed

The committed screenshots are generated too, from the demo build. Regenerate and
look at what moved:

```sh
pnpm screenshots
git status --short docs/images
```

Every file listed should be one you expected to change. A screenshot that moved
for a change you did not make is worth understanding before committing it; a
screenshot that did not move for a change you did make means the change is not
reaching the interface.

## Reporting

Show the commands and what they returned. "Verified" without the output is not
a result — the point of this procedure is that the evidence is quotable.
