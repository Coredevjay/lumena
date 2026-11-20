# Lumen Playground Example

## Overview

An interactive Vite + React application demonstrating **seedless wallet
onboarding**, **gasless transaction signing**, and **spend limit policy
enforcement** powered by `@lumen/web-sdk` and `@lumen/server`:

1. **Seedless wallet onboarding** – create co-managed Stellar wallets without
   private key management.
2. **Wallet balance inspector** – view native XLM and Soroban USDC balances.
3. **Gasless payments** – submit sponsored payments where fee bumps and
   co-signatures are handled by the server.
4. **Policy enforcement controls** – set spend limit, velocity, and
   destination allowlist policies on the co-signer policy engine.
5. **Live log inspector** – real-time view of transaction XDRs, co-sign
   responses, and server policy evaluations.

## Prerequisites

- Node.js 20+ and pnpm installed at the workspace root.
- A running `@lumen/server` (started in the steps below).

## Install and run

1. Start the co-signer and fee sponsor server:

   ```bash
   pnpm install
   pnpm --filter @lumen/server dev
   ```

   The server listens on `http://localhost:3000`.

2. In a separate terminal, launch the playground:

   ```bash
   pnpm --filter playground dev
   ```

3. Open `http://localhost:5173` in a browser.

## Expected output

Creating a wallet shows its funded account address and balances; submitting a
sponsored payment appends the transaction XDR, co-sign response, and policy
evaluation to the live log. Payments that break the configured policy are
rejected and the reason appears in the log.

## Screenshots

A dark glassmorphism dashboard with wallet, balance, payment, and policy panels
alongside the live log inspector.

## How it fits together

```
examples/playground/
├── src/
│   ├── App.tsx          # Main interactive interface & components
│   ├── main.tsx         # Application entrypoint
│   └── index.css         # Glassmorphism dark mode UI design system
├── index.html           # HTML template
├── package.json         # Package configuration
└── vite.config.ts       # Vite bundler configuration
```

Use the playground to create a wallet, inspect its funded account address,
configure a policy, submit a sponsored payment, and review the live log output.
Keep `@lumen/server` running while using the playground because co-signing and
fee-bump submission are server-backed flows.
