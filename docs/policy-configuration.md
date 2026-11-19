# Policy Engine Configuration Spec

The Lumen `PolicyEngine` allows integrators to enforce rules on wallets before the co-signer service signs any transaction. This document describes the typescript interfaces, JSON schemas, and API payloads for configuring spend limits, transaction velocity, and destination allowlists.

---

## Table of Contents
1. [TypeScript Interfaces](#1-typescript-interfaces)
2. [JSON Schema](#2-json-schema)
3. [API Reference](#3-api-reference)
   - [POST /policy](#post-policy)
   - [GET /policy/:walletId](#get-policywalletid)
4. [Example Configurations](#4-example-configurations)
   - [Spend Limit Policy](#spend-limit-policy)
   - [USD Spend Limit Policy](#usd-spend-limit-policy)
   - [Velocity Check Policy](#velocity-check-policy)
   - [Allowlist Policy](#allowlist-policy)
   - [Combined Multi-Rule Policy](#combined-multi-rule-policy)
5. [Worked Examples for Every Rule Type](#5-worked-examples-for-every-rule-type)
   - [Example Fixtures](#example-fixtures)
   - [Rule Type Matrix](#rule-type-matrix)
   - [Running the Examples in CI](#running-the-examples-in-ci)

---

## 1. TypeScript Interfaces

The policy-related types are exported by the `@lumen/types` package:

```typescript
export interface Policy {
  id: string;          // Automatically generated UUID
  walletId: string;    // The public Stellar address of the user wallet
  rules: PolicyRule[]; // Array of active rules applied to this wallet
  createdAt: Date;     // Server creation timestamp
}

export type PolicyRule =
  | SpendLimit
  | UsdSpendLimit
  | VelocityRule
  | AllowlistRule
  | SessionKeyPolicyRule
  | TimeBoundsRule;

/**
 * Limits spend amounts for specific assets.
 */
export interface SpendLimit {
  type: "spend_limit";
  asset: string;       // "native" (for XLM) or a specific asset code
  maxPerTx: string;    // Decimal string representing max amount per transaction
  maxDaily: string;    // Decimal string representing max cumulative amount per day
}

/**
 * Limits spend amounts expressed in USD, using an on-chain oracle price feed
 * (e.g. Reflector/Band/Pyth or a mock Soroban oracle) to convert asset amounts
 * to their USD equivalent before authorizing a payment.
 *
 * The oracle consumer contract lives in `contracts/oracle-spend-limit/`.
 */
export interface UsdSpendLimit {
  type: "usd_spend_limit";
  asset: string;          // "native" (for XLM) or a specific asset code
  maxPerTxUsd: string;    // Decimal string, max USD value per transaction
  maxDailyUsd: string;    // Decimal string, max cumulative USD value per day
  oracle: OracleConfig;   // Price feed the consumer reads from
}

/**
 * Configuration for the oracle price feed consumed by the USD spend limit.
 */
export interface OracleConfig {
  contractId: string;     // Address of the oracle contract (e.g. Reflector)
  assetKey: string;       // Asset identifier the oracle prices (e.g. "XLM")
  maxPriceAgeSeconds: number; // Max acceptable age of a price before it is stale
}

/**
 * Prevents transaction spam or limits transaction frequency.
 */
export interface VelocityRule {
  type: "velocity";
  maxTransactions: number; // Max number of transactions permitted
  windowMinutes: number;   // Rolling window size in minutes
}

/**
 * Restricts outgoing payments only to pre-approved destinations.
 */
export interface AllowlistRule {
  type: "allowlist";
  destinations: string[]; // List of allowed destination Stellar G... public keys
}

export interface SessionKeyPolicyRule {
  type: "session_key";
  sessionPublicKey: string;
  maxSpend: string;
  expiresAt: number;
}

export interface TimeBoundsRule {
  type: "timebounds";
  maxWindowSeconds?: number;
  allowUnbounded?: boolean;
}
```

---

## 2. JSON Schema

Integrators can use the JSON schema below to validate payloads or autogenerate client models. This schema defines the structure for the `POST /policy` request body.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "CreatePolicyRequest",
  "type": "object",
  "required": ["walletId", "rules"],
  "properties": {
    "walletId": {
      "type": "string",
      "pattern": "^G[A-Z2-7]{55}$",
      "description": "The Stellar G-address representing the user's wallet."
    },
    "rules": {
      "type": "array",
      "minItems": 1,
      "items": {
        "$ref": "#/definitions/PolicyRule"
      },
      "description": "An array of rules to evaluate before co-signing a transaction."
    }
  },
  "definitions": {
    "PolicyRule": {
      "type": "object",
      "discriminator": {
        "propertyName": "type"
      },
      "oneOf": [
        {
          "title": "SpendLimit",
          "type": "object",
          "required": ["type", "asset", "maxPerTx", "maxDaily"],
          "properties": {
            "type": {
              "type": "string",
              "const": "spend_limit"
            },
            "asset": {
              "type": "string",
              "description": "Asset identifier. Use 'native' for XLM."
            },
            "maxPerTx": {
              "type": "string",
              "pattern": "^[0-9]+(?:\\.[0-9]+)?$",
              "description": "Maximum amount permitted in a single transaction (decimal string)."
            },
            "maxDaily": {
              "type": "string",
              "pattern": "^[0-9]+(?:\\.[0-9]+)?$",
              "description": "Maximum aggregate amount permitted within 24 hours (decimal string)."
            }
          }
        },
        {
          "title": "UsdSpendLimit",
          "type": "object",
          "required": ["type", "asset", "maxPerTxUsd", "maxDailyUsd", "oracle"],
          "properties": {
            "type": {
              "type": "string",
              "const": "usd_spend_limit"
            },
            "asset": {
              "type": "string",
              "description": "Asset identifier. Use 'native' for XLM."
            },
            "maxPerTxUsd": {
              "type": "string",
              "pattern": "^[0-9]+(?:\\.[0-9]+)?$",
              "description": "Maximum USD value permitted in a single transaction (decimal string)."
            },
            "maxDailyUsd": {
              "type": "string",
              "pattern": "^[0-9]+(?:\\.[0-9]+)?$",
              "description": "Maximum aggregate USD value permitted within 24 hours (decimal string)."
            },
            "oracle": {
              "type": "object",
              "required": ["contractId", "assetKey", "maxPriceAgeSeconds"],
              "properties": {
                "contractId": {
                  "type": "string",
                  "description": "Address of the oracle contract (e.g. Reflector)."
                },
                "assetKey": {
                  "type": "string",
                  "description": "Asset identifier the oracle prices (e.g. 'XLM')."
                },
                "maxPriceAgeSeconds": {
                  "type": "integer",
                  "minimum": 1,
                  "description": "Maximum acceptable age of a price before it is treated as stale."
                }
              }
            }
          }
        },
        {
          "title": "VelocityRule",
          "type": "object",
          "required": ["type", "maxTransactions", "windowMinutes"],
          "properties": {
            "type": {
              "type": "string",
              "const": "velocity"
            },
            "maxTransactions": {
              "type": "integer",
              "minimum": 1,
              "description": "Maximum number of transactions allowed in the window."
            },
            "windowMinutes": {
              "type": "integer",
              "minimum": 1,
              "description": "Rolling window size in minutes."
            }
          }
        },
        {
          "title": "AllowlistRule",
          "type": "object",
          "required": ["type", "destinations"],
          "properties": {
            "type": {
              "type": "string",
              "const": "allowlist"
            },
            "destinations": {
              "type": "array",
              "items": {
                "type": "string",
                "pattern": "^G[A-Z2-7]{55}$",
                "description": "Stellar public address (G...)."
              },
              "description": "Approved destination addresses."
            }
          }
        }
      ]
    }
  }
}
```

---

## 3. API Reference

### POST `/policy`

Registers or updates the co-signing policy rules associated with a wallet.

- **URL**: `/policy`
- **Method**: `POST`
- **Headers**:
  - `Content-Type: application/json`

#### Request Body
```json
{
  "walletId": "GB2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "spend_limit",
      "asset": "native",
      "maxPerTx": "100.0",
      "maxDaily": "500.0"
    }
  ]
}
```

#### Response (200 OK)
Returns the created policy containing the generated `id` and `createdAt` timestamp.
```json
{
  "id": "c1a2e3f4-5b6c-7d8e-9f0a-1b2c3d4e5f6a",
  "walletId": "GB2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "spend_limit",
      "asset": "native",
      "maxPerTx": "100.0",
      "maxDaily": "500.0"
    }
  ],
  "createdAt": "2026-07-16T13:40:00.000Z"
}
```

### GET `/policy/:walletId`

Retrieves the policy currently configured for the specified wallet.

- **URL**: `/policy/:walletId`
- **Method**: `GET`

#### Response (200 OK)
```json
{
  "id": "c1a2e3f4-5b6c-7d8e-9f0a-1b2c3d4e5f6a",
  "walletId": "GB2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "spend_limit",
      "asset": "native",
      "maxPerTx": "100.0",
      "maxDaily": "500.0"
    }
  ],
  "createdAt": "2026-07-16T13:40:00.000Z"
}
```

#### Response (404 Not Found)
Returned when no policy configuration exists for the provided `walletId`.
```json
{
  "error": "No policy found"
}
```

---

## 4. Example Configurations

### Spend Limit Policy

Limits user transactions to a maximum of 50 XLM per transaction, and an aggregate of 200 XLM per day.

#### Request Payload
```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "spend_limit",
      "asset": "native",
      "maxPerTx": "50",
      "maxDaily": "200"
    }
  ]
}
```

### USD Spend Limit Policy

Limits spend by **USD value** rather than a static asset amount, so limits stay
stable when the fiat value of XLM fluctuates. The oracle consumer contract
(`contracts/oracle-spend-limit/`) reads the price feed, converts the payment
amount to USD using standard precision math, and compares the result against
`maxPerTxUsd` and `maxDailyUsd`.

- `oracle.contractId` — address of the price feed contract (e.g. Reflector).
- `oracle.assetKey` — the asset the oracle prices (e.g. `XLM`).
- `oracle.maxPriceAgeSeconds` — a price older than this is considered **stale**.

**Fail-safe behavior:** if the oracle price is stale (older than
`maxPriceAgeSeconds`) or missing (no price published for the asset), the rule
**fails closed** — the transaction is rejected and never co-signed. The consumer
does not fall back to a cached or default price.

#### Request Payload
```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "usd_spend_limit",
      "asset": "native",
      "maxPerTxUsd": "25.00",
      "maxDailyUsd": "100.00",
      "oracle": {
        "contractId": "CBX2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
        "assetKey": "XLM",
        "maxPriceAgeSeconds": 300
      }
    }
  ]
}
```

### Velocity Check Policy

Allows a maximum of 5 transactions every 60 minutes.

#### Request Payload
```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "velocity",
      "maxTransactions": 5,
      "windowMinutes": 60
    }
  ]
}
```

### Allowlist Policy

Restricts outgoing payments to a specific set of safe addresses (e.g. withdrawal endpoints or internal storage).

#### Request Payload
```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "allowlist",
      "destinations": [
        "GBL7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2KGD3Y2Z5XQ7Y6F3",
        "GC2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K"
      ]
    }
  ]
}
```

### Combined Multi-Rule Policy

All rules in the array are evaluated sequentially. A transaction will only be co-signed if it passes **every** rule.

In the example below:
1. Max transaction size is 10 XLM, max daily is 50 XLM.
2. Max 3 transactions are allowed every 10 minutes.
3. Transactions can only send to the listed addresses.

#### Request Payload
```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "spend_limit",
      "asset": "native",
      "maxPerTx": "10",
      "maxDaily": "50"
    },
    {
      "type": "velocity",
      "maxTransactions": 3,
      "windowMinutes": 10
    },
    {
      "type": "allowlist",
      "destinations": [
        "GC2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K"
      ]
    }
  ]
}
```

---

## 5. Worked Examples for Every Rule Type

Every `PolicyRule` variant has a worked example: a policy JSON, a sample
transaction that **passes** the rule, and a sample transaction that is
**denied**. The examples are stored as JSON fixtures under
[`docs/examples/policy/`](./examples/policy/) and are loaded and evaluated by
the test `test/policy/examples.test.ts`, so they are verified on every CI run.

### Example Fixtures

Each rule type has three files in `docs/examples/policy/`:

| File | Contents |
| --- | --- |
| `<rule>.policy.json` | A `CreatePolicyRequest` body containing a single rule of that type. |
| `<rule>.pass.json` | A sample transaction that satisfies the rule. |
| `<rule>.deny.json` | A sample transaction that violates the rule. |

Sample transactions share a common shape:

```json
{
  "source": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "destination": "GC2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "asset": "native",
  "amount": "10",
  "operations": 1,
  "feeStroops": 100,
  "contractId": "CBX2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "function": "transfer",
  "timeBounds": { "minTime": 0, "maxTime": 600 },
  "sessionPublicKey": "GB2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "usdValue": "5.00",
  "usdDailyTotal": "20.00",
  "transactionsInWindow": 1,
  "dailyTotal": "10"
}
```

Only the fields relevant to a given rule need to be present; the evaluator
ignores the rest.

### Rule Type Matrix

| Rule type | Policy fixture | Passing transaction | Denied transaction | Why the denied case fails |
| --- | --- | --- | --- | --- |
| `spend_limit` | [`spend_limit.policy.json`](./examples/policy/spend_limit.policy.json) | [`spend_limit.pass.json`](./examples/policy/spend_limit.pass.json) | [`spend_limit.deny.json`](./examples/policy/spend_limit.deny.json) | `amount` exceeds `maxPerTx` |
| `velocity` | [`velocity.policy.json`](./examples/policy/velocity.policy.json) | [`velocity.pass.json`](./examples/policy/velocity.pass.json) | [`velocity.deny.json`](./examples/policy/velocity.deny.json) | `transactionsInWindow` exceeds `maxTransactions` |
| `allowlist` | [`allowlist.policy.json`](./examples/policy/allowlist.policy.json) | [`allowlist.pass.json`](./examples/policy/allowlist.pass.json) | [`allowlist.deny.json`](./examples/policy/allowlist.deny.json) | `destination` is not in `destinations` |
| `blocklist` | [`blocklist.policy.json`](./examples/policy/blocklist.policy.json) | [`blocklist.pass.json`](./examples/policy/blocklist.pass.json) | [`blocklist.deny.json`](./examples/policy/blocklist.deny.json) | `destination` is in `destinations` |
| `asset_allowlist` | [`asset_allowlist.policy.json`](./examples/policy/asset_allowlist.policy.json) | [`asset_allowlist.pass.json`](./examples/policy/asset_allowlist.pass.json) | [`asset_allowlist.deny.json`](./examples/policy/asset_allowlist.deny.json) | `asset` is not in `assets` |
| `session_key` | [`session_key.policy.json`](./examples/policy/session_key.policy.json) | [`session_key.pass.json`](./examples/policy/session_key.pass.json) | [`session_key.deny.json`](./examples/policy/session_key.deny.json) | `sessionPublicKey` does not match or `amount` exceeds `maxSpend` |
| `timebounds` | [`timebounds.policy.json`](./examples/policy/timebounds.policy.json) | [`timebounds.pass.json`](./examples/policy/timebounds.pass.json) | [`timebounds.deny.json`](./examples/policy/timebounds.deny.json) | `timeBounds` window exceeds `maxWindowSeconds` |
| `max_operations` | [`max_operations.policy.json`](./examples/policy/max_operations.policy.json) | [`max_operations.pass.json`](./examples/policy/max_operations.pass.json) | [`max_operations.deny.json`](./examples/policy/max_operations.deny.json) | `operations` exceeds `maxOperations` |
| `fee_limit` | [`fee_limit.policy.json`](./examples/policy/fee_limit.policy.json) | [`fee_limit.pass.json`](./examples/policy/fee_limit.pass.json) | [`fee_limit.deny.json`](./examples/policy/fee_limit.deny.json) | `feeStroops` exceeds `maxFeeStroops` |
| `contract_allowlist` | [`contract_allowlist.policy.json`](./examples/policy/contract_allowlist.policy.json) | [`contract_allowlist.pass.json`](./examples/policy/contract_allowlist.pass.json) | [`contract_allowlist.deny.json`](./examples/policy/contract_allowlist.deny.json) | `contractId` is not in `contracts` |
| `contract_invocation` | [`contract_invocation.policy.json`](./examples/policy/contract_invocation.policy.json) | [`contract_invocation.pass.json`](./examples/policy/contract_invocation.pass.json) | [`contract_invocation.deny.json`](./examples/policy/contract_invocation.deny.json) | `function` is not in `allowedFunctions` |
| `usd_spend_limit` | [`usd_spend_limit.policy.json`](./examples/policy/usd_spend_limit.policy.json) | [`usd_spend_limit.pass.json`](./examples/policy/usd_spend_limit.pass.json) | [`usd_spend_limit.deny.json`](./examples/policy/usd_spend_limit.deny.json) | `usdValue` exceeds `maxPerTxUsd` (or the price is stale) |

#### Example: `spend_limit`

Policy (`docs/examples/policy/spend_limit.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    { "type": "spend_limit", "asset": "native", "maxPerTx": "50", "maxDaily": "200" }
  ]
}
```

Passing transaction (`spend_limit.pass.json`) — 10 XLM is under both limits:

```json
{ "asset": "native", "amount": "10", "dailyTotal": "10" }
```

Denied transaction (`spend_limit.deny.json`) — 75 XLM exceeds `maxPerTx`:

```json
{ "asset": "native", "amount": "75", "dailyTotal": "10" }
```

#### Example: `velocity`

Policy (`velocity.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    { "type": "velocity", "maxTransactions": 5, "windowMinutes": 60 }
  ]
}
```

Passing transaction (`velocity.pass.json`) — 2 transactions in the window:

```json
{ "transactionsInWindow": 2 }
```

Denied transaction (`velocity.deny.json`) — 6 transactions in the window:

```json
{ "transactionsInWindow": 6 }
```

#### Example: `allowlist`

Policy (`allowlist.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "allowlist",
      "destinations": ["GC2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K"]
    }
  ]
}
```

Passing transaction (`allowlist.pass.json`) — destination is approved:

```json
{ "destination": "GC2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K" }
```

Denied transaction (`allowlist.deny.json`) — destination is not approved:

```json
{ "destination": "GBL7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2KGD3Y2Z5XQ7Y6F3" }
```

#### Example: `blocklist`

Policy (`blocklist.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "blocklist",
      "destinations": ["GBL7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2KGD3Y2Z5XQ7Y6F3"]
    }
  ]
}
```

Passing transaction (`blocklist.pass.json`) — destination is not blocked:

```json
{ "destination": "GC2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K" }
```

Denied transaction (`blocklist.deny.json`) — destination is blocked:

```json
{ "destination": "GBL7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2KGD3Y2Z5XQ7Y6F3" }
```

#### Example: `asset_allowlist`

Policy (`asset_allowlist.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    { "type": "asset_allowlist", "assets": ["native", "USDC"] }
  ]
}
```

Passing transaction (`asset_allowlist.pass.json`) — asset is approved:

```json
{ "asset": "USDC", "amount": "10" }
```

Denied transaction (`asset_allowlist.deny.json`) — asset is not approved:

```json
{ "asset": "AQUA", "amount": "10" }
```

#### Example: `session_key`

Policy (`session_key.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "session_key",
      "sessionPublicKey": "GB2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
      "maxSpend": "25",
      "expiresAt": 1893456000
    }
  ]
}
```

Passing transaction (`session_key.pass.json`) — matching key, within spend:

```json
{
  "sessionPublicKey": "GB2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "amount": "10"
}
```

Denied transaction (`session_key.deny.json`) — spend exceeds `maxSpend`:

```json
{
  "sessionPublicKey": "GB2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "amount": "40"
}
```

#### Example: `timebounds`

Policy (`timebounds.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    { "type": "timebounds", "maxWindowSeconds": 3600, "allowUnbounded": false }
  ]
}
```

Passing transaction (`timebounds.pass.json`) — 10 minute window:

```json
{ "timeBounds": { "minTime": 0, "maxTime": 600 } }
```

Denied transaction (`timebounds.deny.json`) — 2 hour window:

```json
{ "timeBounds": { "minTime": 0, "maxTime": 7200 } }
```

#### Example: `max_operations`

Policy (`max_operations.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    { "type": "max_operations", "maxOperations": 3 }
  ]
}
```

Passing transaction (`max_operations.pass.json`):

```json
{ "operations": 2 }
```

Denied transaction (`max_operations.deny.json`):

```json
{ "operations": 5 }
```

#### Example: `fee_limit`

Policy (`fee_limit.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    { "type": "fee_limit", "maxFeeStroops": 1000 }
  ]
}
```

Passing transaction (`fee_limit.pass.json`):

```json
{ "feeStroops": 100 }
```

Denied transaction (`fee_limit.deny.json`):

```json
{ "feeStroops": 5000 }
```

#### Example: `contract_allowlist`

Policy (`contract_allowlist.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "contract_allowlist",
      "contracts": ["CBX2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K"]
    }
  ]
}
```

Passing transaction (`contract_allowlist.pass.json`) — contract is approved:

```json
{ "contractId": "CBX2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K" }
```

Denied transaction (`contract_allowlist.deny.json`) — contract is not approved:

```json
{ "contractId": "CD4Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K" }
```

#### Example: `contract_invocation`

Policy (`contract_invocation.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "contract_invocation",
      "contractId": "CBX2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
      "allowedFunctions": ["transfer"]
    }
  ]
}
```

Passing transaction (`contract_invocation.pass.json`) — allowed function:

```json
{
  "contractId": "CBX2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "function": "transfer"
}
```

Denied transaction (`contract_invocation.deny.json`) — function not allowed:

```json
{
  "contractId": "CBX2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "function": "admin_withdraw"
}
```

#### Example: `usd_spend_limit`

Policy (`usd_spend_limit.policy.json`):

```json
{
  "walletId": "GD3Y2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
  "rules": [
    {
      "type": "usd_spend_limit",
      "asset": "native",
      "maxPerTxUsd": "25.00",
      "maxDailyUsd": "100.00",
      "oracle": {
        "contractId": "CBX2X2Z5XQ7Y6F3T3C7F5N5YUXW2QZQXUYQ7C5W4F5A6S7D8F9G0H1J2K",
        "assetKey": "XLM",
        "maxPriceAgeSeconds": 300
      }
    }
  ]
}
```

Passing transaction (`usd_spend_limit.pass.json`) — USD value under the limit:

```json
{ "asset": "native", "amount": "10", "usdValue": "5.00", "usdDailyTotal": "20.00" }
```

Denied transaction (`usd_spend_limit.deny.json`) — USD value over the limit:

```json
{ "asset": "native", "amount": "100", "usdValue": "50.00", "usdDailyTotal": "20.00" }
```

### Running the Examples in CI

The fixtures above are exercised by `test/policy/examples.test.ts`. The test:

1. Reads every `*.policy.json` file in `docs/examples/policy/`.
2. Loads the matching `*.pass.json` and `*.deny.json` sample transactions.
3. Evaluates each transaction against the policy with the `PolicyEngine`.
4. Asserts the pass sample is allowed and the deny sample is rejected.
5. Asserts that every `PolicyRule` type has a fixture set, so a new rule type
   cannot be added without a worked example.

Run it locally with:

```bash
npm test -- test/policy/examples.test.ts
```

Because the test runs as part of the default `npm test` suite, the examples are
validated on every CI run.
