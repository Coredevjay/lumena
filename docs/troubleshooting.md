# Troubleshooting

## Typed errors and error codes

`@lumen/core` throws a `LumenError` (or one of its subclasses) instead of a
plain `Error`. Every instance carries a stable `code` you can branch on, an
optional `cause` (the underlying error, if any) and a human-readable `message`.
Because the classes are exported from the package entry point, `instanceof`
checks work across ESM and CJS consumers:

```ts
import {
  LumenError,
  PolicyDeniedError,
  NetworkError,
  SignerError,
} from "@lumen/core";

try {
  await client.horizon.submitTransaction(tx);
} catch (err) {
  if (err instanceof PolicyDeniedError) {
    // the policy engine rejected the request
  } else if (err instanceof NetworkError) {
    // Horizon was unreachable or returned a transport error
  } else if (err instanceof SignerError) {
    // signing failed
  } else if (err instanceof LumenError) {
    switch (err.code) {
      case "NETWORK_TIMEOUT":
        // ...
        break;
    }
  }
}
```

Prefer branching on `code` when you only need the error category, and on
`instanceof` when you need the subclass-specific properties. Codes are stable
across releases; messages are not.

### Error codes

| Code | Subclass | Meaning | Remediation |
| --- | --- | --- | --- |
| `LUMEN_ERROR` | `LumenError` | Generic base error raised when no more specific code applies. | Inspect `cause` for details. |
| `POLICY_DENIED` | `PolicyDeniedError` | The policy engine rejected the request. | Adjust the request or the wallet policy. |
| `POLICY_NOT_FOUND` | `PolicyDeniedError` | No policy is configured for the wallet. | Create a policy for the wallet before sending. |
| `NETWORK_ERROR` | `NetworkError` | A transport-level failure talking to Horizon or another service. | Retry the request; check connectivity. |
| `NETWORK_TIMEOUT` | `NetworkError` | The request exceeded its timeout or was aborted. | Retry with a longer timeout or check the network. |
| `NETWORK_RATE_LIMITED` | `NetworkError` | The remote service returned a rate-limit response. | Back off and retry later. |
| `SIGNER_ERROR` | `SignerError` | Signing failed for an unspecified reason. | Check the signer configuration and key material. |
| `SIGNER_UNAVAILABLE` | `SignerError` | The configured signer could not be reached. | Verify the signer service is running and reachable. |
| `SIGNER_REJECTED` | `SignerError` | The signer refused to sign the payload. | Review the signer's policy and the payload being signed. |

## Retries and cancellation

Horizon calls, streaming helpers and SEP clients share a single retry
implementation from `@lumen/core` (`utils/retry.ts`). It applies exponential
backoff with jitter and honours an `AbortSignal`, so a single signal cancels
both the in-flight request and any pending retry:

```ts
import { withRetry } from "@lumen/core";

const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);

const account = await withRetry(
  () => client.horizon.loadAccount(publicKey),
  { signal: controller.signal, maxAttempts: 5 },
);
```

Pass the same `signal` to streaming helpers and SEP clients; aborting it stops
the stream and rejects any pending retry with a `NetworkError` whose `code` is
`NETWORK_TIMEOUT`. Do not write ad-hoc retry loops in application code — use
`withRetry` so backoff, jitter and cancellation behave consistently.

## Transaction result codes

When Horizon rejects a transaction, Lumen maps the raw result codes to a typed,
user-friendly error with `parseResultCodes()` from `@lumen/core`:

```ts
import { parseResultCodes } from "@lumen/core";

try {
  await client.horizon.submitTransaction(tx);
} catch (err) {
  const parsed = parseResultCodes(err);
  // { code: "op_underfunded", operationIndex: 0, message: "...", hint: "..." }
}
```

`parseResultCodes()` accepts a Horizon submission error, its response body or a
raw `result_codes` object. When the transaction failed because of an operation,
the first failing operation is reported along with its `operationIndex`;
transaction-level codes have an `operationIndex` of `null`. Codes are normalized
to lower snake case, so `txBAD_SEQ` and `tx_bad_seq` are treated the same.
Unknown codes fall back to a generic message and hint.

`Wallet.send` throws a `StellarResultError` (with `code`, `operationIndex` and
`hint` properties) when the fee-bump submission is rejected with a result code.
The server returns the same information in its error envelope with status `400`:

```json
{
  "error": "The source account does not have enough funds.",
  "code": "op_underfunded",
  "operationIndex": 0,
  "hint": "Fund the account or reduce the amount."
}
```

### Transaction-level codes

| Code | Message | Hint |
| --- | --- | --- |
| `tx_failed` | One or more operations failed. | Inspect the operation result codes for the specific failure. |
| `tx_too_early` | The transaction's time bounds have not started yet. | Wait until the minimum time bound or rebuild the transaction. |
| `tx_too_late` | The transaction has expired. | Rebuild and re-sign the transaction with a new timeout. |
| `tx_missing_operation` | The transaction has no operations. | Add at least one operation before submitting. |
| `tx_bad_seq` | The sequence number does not match the source account. | Reload the source account and rebuild the transaction. |
| `tx_bad_auth` | The transaction is missing required signatures or has invalid ones. | Check that every required signer has signed and the network passphrase is correct. |
| `tx_insufficient_balance` | The fee would bring the source account below its minimum reserve. | Fund the source account with more XLM. |
| `tx_no_account` | The source account does not exist. | Create and fund the source account first. |
| `tx_insufficient_fee` | The fee is too low for current network conditions. | Increase the fee and resubmit. |
| `tx_bad_auth_extra` | The transaction has unused signatures. | Remove signatures that are not required. |
| `tx_internal_error` | An unknown internal error occurred in the network. | Retry the submission later. |
| `tx_not_supported` | The transaction type is not supported by the network. | Check the protocol version of the network you are submitting to. |
| `tx_fee_bump_inner_failed` | The inner transaction of the fee bump failed. | Inspect the inner transaction result codes for the specific failure. |
| `tx_bad_sponsorship` | A sponsorship was not properly closed. | Pair every begin-sponsoring operation with an end-sponsoring operation. |
| `tx_bad_min_seq_age_or_gap` | The minimum sequence age or gap precondition was not met. | Wait for the precondition to be satisfied or rebuild the transaction. |
| `tx_malformed` | The transaction is malformed. | Rebuild the transaction and check its preconditions. |
| `tx_soroban_invalid` | The Soroban transaction data is invalid. | Re-simulate the transaction and apply the returned resources before signing. |

### Operation-level codes

| Code | Message | Hint |
| --- | --- | --- |
| `op_inner` | The operation failed. | Inspect the operation details for the specific failure. |
| `op_bad_auth` | The operation is missing required signatures. | Check that the operation source account has signed. |
| `op_no_source_account` | The operation source account does not exist. | Create and fund the operation source account first. |
| `op_not_supported` | The operation is not supported by the network. | Check the protocol version of the network you are submitting to. |
| `op_too_many_subentries` | The account has reached its subentry limit. | Remove unused trustlines, offers or data entries. |
| `op_exceeded_work_limit` | The operation exceeded the network work limit. | Split the work into smaller operations. |
| `op_too_many_sponsoring` | The account is sponsoring too many entries. | Reduce the number of sponsored entries. |
| `op_malformed` | The operation is malformed. | Check the operation parameters (amounts, assets, addresses). |
| `op_underfunded` | The source account does not have enough funds. | Fund the account or reduce the amount. |
| `op_src_no_trust` | The source account does not trust the asset being sent. | Add a trustline for the asset on the source account. |
| `op_src_not_authorized` | The source account is not authorized to send this asset. | Ask the asset issuer to authorize the source account. |
| `op_no_destination` | The destination account does not exist. | Create the destination account first or send enough XLM to create it. |
| `op_no_trust` | The destination account does not trust the asset. | The recipient must add a trustline for the asset before receiving it. |
| `op_not_authorized` | The destination account is not authorized to hold this asset. | Ask the asset issuer to authorize the destination account. |
| `op_line_full` | The destination trustline limit would be exceeded. | The recipient must raise their trustline limit. |
| `op_no_issuer` | The asset issuer does not exist. | Check the asset code and issuer address. |
| `op_already_exists` | The account already exists. | Use a payment instead of creating the account. |
| `op_low_reserve` | The account would fall below its minimum reserve. | Fund the account with more XLM. |
| `op_too_few_offers` | No path was found to complete the path payment. | Try a different path or a smaller amount. |
| `op_over_source_max` | The path payment would cost more than the maximum allowed. | Increase the maximum send amount or retry later. |
| `op_under_dest_min` | The path payment would deliver less than the minimum required. | Lower the minimum destination amount or retry later. |
| `op_cross_self` | The offer would cross an offer from the same account. | Cancel or adjust your existing offer. |
| `op_invalid_limit` | The trustline limit is below the current balance or liabilities. | Set a limit greater than or equal to the current balance. |
| `op_trapped` | The contract invocation trapped. | Check the contract diagnostic events for the cause. |
| `op_resource_limit_exceeded` | The contract invocation exceeded its resource limits. | Re-simulate the transaction and apply the returned resources. |
| `op_entry_archived` | A contract ledger entry has been archived. | Restore the archived entry before invoking the contract. |
| `op_insufficient_refundable_fee` | The refundable fee is too low for the contract invocation. | Re-simulate the transaction and increase the resource fee. |

## Reloading configuration with SIGHUP

Non-critical settings can be reloaded without restarting the server by sending
`SIGHUP` to the process:

```sh
kill -HUP <pid>
# or, when running in Docker
docker kill --signal=HUP <container>
```

The following settings are reloadable:

| Setting | Description |
| --- | --- |
| Log level | Verbosity of the server logs (e.g. `debug`, `info`, `warn`, `error`). |
| Rate limits | Request rate limits applied per client. |
| CORS allowlist | The list of origins allowed to make cross-origin requests. |

All other settings (ports, database connection strings, signing keys, etc.)
still require a full restart.

On reload the configuration is validated first. If it is invalid, a warning is
logged describing the problem and the previous values are kept, so a bad edit
never takes the server down. Fix the configuration and send `SIGHUP` again to
apply it.

## Prometheus metrics

### Route labels

HTTP metrics are labelled with the route pattern rather than the raw request
path, so `/policy/GABC...` is reported as `/policy/:walletId`. This keeps label
cardinality bounded and prevents wallet addresses from leaking into metrics.
When adding new routes, always label them with the registered route pattern.

### Cosign latency histogram

The `cosign_latency_seconds` histogram uses buckets tuned for signing
round-trips (in seconds):

```
0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10
```

Use these buckets when building dashboards or alerts so latency panels match
the exported data.
