# Phase 24 — Release Manifest Git-Metadata Exclusion Closure

## Incident

The Active Operations estimate-display hotfix was prepared from a Git linked worktree. In a linked worktree, `.git` is a small metadata **file** that points back to the parent repository rather than a directory. The Phase 22 package walker excluded `.git` only when it was a directory, so the generated `RELEASE_FILE_MANIFEST.sha256` incorrectly contained an entry for `.git`.

On the VPS candidate, `.git` is a normal directory. `sha256sum -c RELEASE_FILE_MANIFEST.sha256` therefore failed with `sha256sum: .git: Is a directory` before certification or deployment began. Production was not modified.

## Closure

- Phase 22 now excludes ignored metadata names before testing whether an entry is a file or directory, so linked-worktree `.git` pointer files are never treated as distributable source.
- Manifest parsing explicitly rejects `.git` and any path below `.git/`.
- The release manifest is regenerated strictly from Git-tracked files, excluding the manifest itself.
- Packaging excludes `.git` metadata entirely while preserving required distributable dotfiles such as `.gitattributes`, `.gitignore`, `.npmrc`, and `backend/.env.example`.

## Safety

This closure changes only release-package verification/metadata. It does not change frontend runtime behavior, backend runtime behavior, PostgreSQL data, finance/payment logic, attendance, task lifecycle, files, migrations, or API contracts.
