# Continuous Integration & Automation

Lumen uses GitHub Actions to automate testing, linting, and build verification for all packages across the monorepo.

## Workflows

### CI (`.github/workflows/ci.yml`)

The CI workflow triggers on:
- Pushes to the `main` branch
- Pull requests targeting `main`

### Pipeline Stages

1. **Checkout Repository**: Clones repository code with submodules if any.
2. **Setup Node.js 20**: Sets up the Node.js runtime environment.
3. **Install pnpm 9**: Installs the configured pnpm package manager.
4. **Cache Dependencies**: Uses GitHub cache action to cache pnpm store directory based on lockfile hash.
5. **Install Dependencies**: Executes `pnpm install --frozen-lockfile` to ensure exact dependency resolution.
6. **Linter**: Executes `pnpm lint` via ESLint across all workspace packages.
7. **Build Packages**: Compiles TypeScript across all workspace packages via Turborepo (`pnpm build`).
8. **Unit Tests**: Runs Vitest test suites across all packages (`pnpm test`).
9. **Build API Docs**: Generates the TypeDoc reference for all public exports (`pnpm docs`). The build fails if any exported symbol is missing documentation, so every public type, option, and function must have a JSDoc comment. The generated HTML is uploaded as a `typedoc` build artifact.
10. **Validate Package Types**: Runs `publint` and `@arethetypeswrong/cli` against the published packages to catch broken `exports` maps, incorrect `types`/`main` fields, and module-resolution mismatches (ESM/CJS) before release.

### API Documentation (TypeDoc)

The public API reference is generated from JSDoc comments using TypeDoc. The
configuration lives in `typedoc.json` at the repository root and covers the
public entry points of each package.

To build the docs locally:

```
pnpm docs
```

The output is written to `docs/api/` (git-ignored). CI runs the same command and
fails on any TypeDoc warning, including undocumented exports.

### Package Type Validation

Two tools validate the published package metadata:

- **publint** checks `package.json` fields (`exports`, `main`, `module`, `types`)
  for correctness and consistency.
- **arethetypeswrong** (`attw`) verifies that type declarations resolve correctly
  under every supported module resolution mode.

To run them locally:

```
pnpm --filter "@lumen/core" exec publint
pnpm --filter "@lumen/core" exec attw --pack .
```

Replace `@lumen/core` with the package you are validating. CI runs both tools
across all published packages and fails on any reported problem.

### Schema Snapshots

The generated OpenAPI spec (`packages/server/src/openapi.ts`) and the policy JSON
schema (derived from `PolicyRequestSchema` in `packages/server/src/validation.ts`)
are snapshotted in `packages/server/src/__tests__/__snapshots__/`. Any change to
either schema fails the `schema-snapshots` test in CI until the snapshots are
updated explicitly.

To update the snapshots after an intentional schema change:

1. Regenerate them:
   ```
   pnpm --filter "@lumen/server" exec vitest run src/__tests__/schema-snapshots.test.ts -u
   ```
2. Review the snapshot diff for breaking changes (removed paths, fields, enum
   values or newly required properties).
3. Add a changeset describing the change, using a `major` bump for breaking changes:
   ```
   pnpm changeset
   ```
4. Commit the updated snapshots together with the changeset.

On pull requests, CI fails if the snapshots change without a new `.changeset/*.md` file.

### Contracts (`.github/workflows/contracts.yml`)

The Contracts workflow validates Soroban smart contracts. It triggers on:
- Pushes to the `main` branch that modify contract code
- Pull requests targeting `main` that modify contract code

Trigger paths are scoped to contract-related files so that unrelated changes do not run the contract pipeline:
- `contracts/**`
- `Cargo.toml` and `Cargo.lock`
- `.github/workflows/contracts.yml`

#### Pipeline Stages

1. **Checkout Repository**: Clones repository code.
2. **Setup Rust Toolchain**: Installs the stable Rust toolchain and adds the `wasm32-unknown-unknown` compilation target.
3. **Cache Cargo**: Caches the Cargo registry and build artifacts to speed up subsequent runs.
4. **Build Contracts**: Compiles the Soroban contracts for the WebAssembly target in release mode:
   ```
   cargo build --target wasm32-unknown-unknown --release
   ```
5. **Strip & Optimize WASM**: Runs `wasm-opt` on the compiled `.wasm` artifacts to strip debug information and optimize the binary, reducing its size.
6. **Enforce Size Budget**: Verifies that each optimized WASM binary is smaller than the **64KB** size budget. The workflow **fails** if any contract exceeds this limit, preventing oversized contracts from being merged.
7. **Export TypeScript ABI**: Generates TypeScript interface definitions from the contract ABI so that client packages can consume typed contract bindings.

#### Acceptance Criteria

- The workflow triggers on contract code changes.
- The workflow fails if any WASM binary exceeds the 64KB size budget.

Contributors modifying contracts should run the equivalent build, `wasm-opt`, and size checks locally before pushing to avoid CI failures.