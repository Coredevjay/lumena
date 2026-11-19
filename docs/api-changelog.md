# API Changelog

History of changes to the `@lumen/server` REST API. Package releases are tracked
by Changesets in [CHANGELOG.md](../CHANGELOG.md); this file covers the HTTP
contract only.

`packages/server/src/openapi.ts` is the source of truth for the API
specification. `docs/openapi.yaml` is the published copy and must be kept in
sync with it (its `openapi` and `info.version` fields are checked by
`packages/server/src/__tests__/openapi.test.ts`).

## Changelog

| API version | Date | Type | Change |
|---|---|---|---|
| `0.1.0` | Initial | Added | Initial API: `/health`, `/cosign`, `/fee-bump`, `/fee-bump/submit`, `/wallets`, `/wallet/create`, `/wallet/{address}/transactions`, `/wallet/{address}/analytics`, `/wallet/{address}/balance`, `/policy`, `/policy/{walletId}`, `/webhooks`, `/webhooks/{id}`, `/webhooks/{id}/test`. |
| `0.1.0` | Initial | Added | TypeDoc-generated API reference for the `@lumen/core` public exports, including `StellarClient` options (networks, timeouts, sponsor, signer). Built in CI and published alongside the package docs. |
| `0.1.0` | Initial | Changed | `@lumen/core` now ships a dual ESM/CJS build with matching type declarations for both module systems. |

## How entries are generated

The release workflow (`.github/workflows/release.yml`) compares
`docs/openapi.yaml` at the previous release tag with the current one using
[oasdiff](https://github.com/oasdiff/oasdiff) and appends the resulting
changelog to this file, so it is included in the Changesets release pull
request. Maintainers then fold the generated section into the table above and
classify each entry.

## Versioning and deprecation policy

The API follows semantic versioning through `info.version` in the OpenAPI spec.

### Breaking changes (major version)

- Removing or renaming a path or HTTP method.
- Removing or renaming a request or response field.
- Making an optional request field or parameter required, or adding a new
  required one.
- Changing the type, format, or allowed values of an existing field in a way
  that rejects previously valid input or returns previously unseen output.
- Changing authentication or authorization requirements of an existing
  operation.
- Changing the meaning of an existing status code or error code.

While the API is `0.x`, breaking changes bump the minor version and are called
out in this file.

### Non-breaking changes (minor version)

- Adding a new path, method, or optional request field.
- Adding a new response field or a new enum value in a response that clients
  are documented to tolerate.
- Adding a new error code for a new failure mode.

### Fixes (patch version)

- Documentation, description, or example corrections with no contract change.

### Deprecation

1. Mark the operation, parameter, or field `deprecated: true` in
   `packages/server/src/openapi.ts` and `docs/openapi.yaml` and add a
   **Deprecated** entry here naming the replacement.
2. Keep a deprecated element working for at least one minor release and no less
   than 90 days before removal.
3. Remove it only in a release that carries the corresponding breaking-change
   version bump, with a **Removed** entry here.
