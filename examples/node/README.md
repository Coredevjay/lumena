# Node Server Wallet Example

## Overview

This example shows the minimum server-side setup for using `@lumen/core` with a
Stellar testnet keypair: it creates a `StellarClient` for testnet and a `Wallet`
for the keypair's public key.

## Prerequisites

- Node.js 20+ and pnpm
- Built `@lumen/core`: `pnpm --filter @lumen/core build`
- Optional: `LUMEN_SERVER_SECRET`, a Stellar testnet secret key (`S...`). A
  random keypair is used when it is not set.

## Install and run

```bash
pnpm install
LUMEN_SERVER_SECRET=S... pnpm --filter @lumen/example-node start
```

## Expected output

The script logs the network, the wallet address, and the native asset code:

```text
{ network: 'testnet', wallet: 'G...', nativeAsset: 'XLM' }
```

## Screenshots

Console-only example; the output above is the complete result.
