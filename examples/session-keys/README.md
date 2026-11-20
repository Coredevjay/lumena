# Lumen Session Keys Example

## Overview

An interactive Vite + React application demonstrating Lumen's **session key**
pattern: scoped, time-limited keys that enable instant micropayments without a
wallet signing prompt for every transaction.

| Feature | Description |
| --- | --- |
| **Session key creation** | Generates a scoped ed25519 keypair via `@lumen/web-sdk` valid for 5 minutes with a 10 XLM spend cap. |
| **Instant micropayments** | A "Tip 0.1 XLM" button sends payments instantly using the session key, with no popup or extra confirmation. |
| **Live spend allowance** | A progress bar shows how much of the 10 XLM cap has been used. |
| **Countdown timer** | A countdown shows remaining session validity; the key expires automatically after 5 minutes. |
| **Manual revocation** | A "Revoke Session Key" button immediately invalidates the session key on-chain. |
| **Event log** | A live log panel shows every event (session created, payment sent, revocation, errors). |

## Prerequisites

- Node.js 20+ and pnpm installed at the workspace root.
- A running `@lumen/server` (started in the steps below).

## Install and run

1. Start the Lumen co-signer server:

   ```bash
   pnpm install
   pnpm --filter @lumen/server dev
   ```

   The server listens on `http://localhost:3000`.

2. Start the session-keys demo:

   ```bash
   pnpm --filter session-keys dev
   ```

   Navigate to `http://localhost:5174` in a browser.

3. Walk through the demo:

   1. **Create a seedless wallet** – click "Create Seedless Wallet". The
      server provisions and sponsors the account.
   2. **Create a session key** – click "Create Session Key". A 5-minute
      scoped keypair is generated and registered on the wallet.
   3. **Send instant micropayments** – click "Tip 0.1 XLM" repeatedly. Each
      tap sends 0.1 XLM with no signing prompt. Watch the spend allowance
      bar fill up.
   4. **Observe expiry** – the countdown timer shows remaining session
      validity. The key expires automatically after 5 minutes.
   5. **Revoke manually** – click "Revoke Session Key" to invalidate the
      session key before it expires.

## Expected output

The event log records session creation, each 0.1 XLM payment, and revocation
or expiry. The spend allowance bar fills toward the 10 XLM cap, and payments
are refused once the cap is reached or the session key has expired or been
revoked.

## Screenshots

A dark-mode page with wallet and session key controls, the "Tip 0.1 XLM"
button, the spend allowance bar, the countdown timer, and the event log panel.

## How it fits together

Session keys work as follows:

```
1. App creates a random ed25519 keypair (the session key)
2. Session key is registered on the wallet account as a scoped signer
   with a spend limit rule enforced by the PolicyEngine
3. Subsequent transactions are signed by the session key (no user prompt)
4. Server co-signs after verifying the spend cap and time bounds
5. Server fee-bumps the transaction (user pays zero XLM in fees)
6. On expiry or manual revocation, the signer weight is removed on-chain
```

```
examples/session-keys/
├── src/
│   ├── App.tsx       # Main demo UI — wallet, session key, micropayments, log
│   ├── main.tsx      # React entrypoint
│   └── index.css     # Dark mode design system
├── index.html        # HTML template
├── package.json      # Dependencies (mirrors examples/playground)
├── tsconfig.json     # TypeScript config
└── vite.config.ts    # Vite dev server on port 5174
```

## Related packages

| Package | Role |
| --- | --- |
| `@lumen/web-sdk` | `LumenClient.createSessionKey()` – generates the scoped keypair |
| `@lumen/core` | `setupSessionKey()` – registers the keypair as a multisig signer |
| `@lumen/server` | `POST /session-key` – validates and persists the session key policy |
| `@lumen/server` | `POST /cosign` – enforces spend cap before co-signing |

## Further reading

- [Lumen README](../../README.md)
- [Gasless transactions guide](../../docs/guides/gasless-transactions.md)
