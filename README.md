# Lucida JavaScript SDKs

Every `@lucida/*` npm package (browser, node, edge, react, vue, svelte, next, and the other framework adapters) in one pnpm workspace under `packages/`.

```sh
pnpm add @lucida/browser   # or @lucida/node, @lucida/react, ...
```

Develop: `pnpm install && pnpm -r test`. Packages reference each other with `workspace:*`; releases are tag-driven (`v*`) and publish every package whose version is not on npm yet, with provenance.

Lockfile: none is mirrored from the monorepo (it spans other workspaces). The first CI run resolves one; commit the generated `pnpm-lock.yaml` here.

---

This repository is a read-only mirror of the Lucida monorepo (synced by a script, never edited by hand); releases and provenance attestations are built here by GitHub Actions. Issues are welcome, changes land upstream.
