# Tasks

## 1. Workspace

- [x] 1.1 Add `pnpm-workspace.yaml` with `packages/jev-kit`, `apps/ten-levels`, and `apps/ten-levels/web`; remove `workspaces` from the root `package.json` and pin `packageManager: pnpm@12.4.2`. Verify that `pnpm install` at the root links the lab to the package, installs the Vue app, and builds `dist/`.
- [x] 1.2 Depend on `@bobobowis/jev-kit` with `workspace:*` in the lab. Verify that `apps/ten-levels/node_modules/@bobobowis/jev-kit` links to `packages/jev-kit`.
- [x] 1.3 Remove `package-lock.json` and `apps/ten-levels/web/bun.lock`, and commit one `pnpm-lock.yaml`. Verify that `pnpm install --frozen-lockfile` succeeds.

## 2. Task runner

- [x] 2.1 In `scripts/run.mjs`, start vite and oxlint through node by their `package.json` bin, and the hero renderer through node. Verify `pnpm run web`, `pnpm run lint`, and `pnpm run heroes`.
- [x] 2.2 Drop a leading `--` from the task's arguments. Verify that `pnpm run level 4 b` and `pnpm run level -- 4 b` both run Level 4 B.

## 3. CI

- [x] 3.1 Install pnpm with `pnpm/action-setup`, cache it in `setup-node`, install with `--frozen-lockfile`, and run every step through pnpm. Pack with `pnpm --filter @bobobowis/jev-kit pack`, and check the tarball in an empty project with `pnpm init`, `pnpm add`, and `pnpm exec jev`. Verify that all six jobs pass (PR #2).

## 4. Docs and content

- [x] 4.1 Switch `AGENTS.md`, the READMEs, `/install`, `.env.sample`, and the specs to pnpm, and regenerate the capability tables. Verify `pnpm run docs --check`.
- [x] 4.2 Switch the sandbox, the level examples, the agent prompts, the agent install hints (`pnpm add -g`, with a `pnpm setup` note), and the hyper-jev starter and cookbook to pnpm. Verify that `pnpm test` passes, the sandbox fails only the proration test, and the starter's tests pass.
- [x] 4.3 Re-measure Level 4 A live on `rm -rf node_modules && pnpm install` and update the README table. Verify that it is still reversible at low confidence and asks a human (0.27, 0.34, 0.33).
- [x] 4.4 Show `pnpm test` in the Level 6 and Level 10 diagrams. Verify that the label matches the diagrams' lettering (issue #3).
