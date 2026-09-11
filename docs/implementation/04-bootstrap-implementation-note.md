# Bootstrap Implementation Note

## Status

Validation pending.

Files for the single-package repository bootstrap have been prepared and statically inspected in the contained environment. Dependency installation, type checking, tests, builds, CI execution, and Vite startup were not run.

## Proposed dependency versions

The versions below preserve the versions already present in the earlier bootstrap scaffold and require offline verification:

- Node.js 22
- pnpm 10.6.1
- Vue 3.5.13
- Vite 6.2.2
- Vitest 3.0.7
- TypeScript 5.7.3
- vue-tsc 2.2.8
- Vue Testing Library 8.1.0
- Vue Vite plugin 5.2.3
- Vue SFC compiler 3.5.13
- jsdom 26.0.0
- Node type definitions 22.13.10

## Offline validation

Run:

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm test:run
pnpm build
pnpm dev
```

After `pnpm install` creates `pnpm-lock.yaml`, stop the development server and run:

```bash
pnpm install --frozen-lockfile
```

Return the Node.js and pnpm versions, full output for failed commands, peer dependency warnings, and confirmation that the playground renders.

## Lockfile

No lockfile was generated in the contained environment because dependency installation was intentionally not run. The developer must generate and commit it through the offline `pnpm install` step.
