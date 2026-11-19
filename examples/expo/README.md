# Lumen Expo example

## Overview

This Expo app demonstrates native key generation from a BIP-39 mnemonic,
encrypted key persistence with Expo SecureStore, and a Stellar testnet payment
that the Lumen server co-signs and submits.

## Prerequisites

- Node.js 20+ and pnpm
- Android Studio (Android) or Xcode on macOS (iOS) for a native development
  build. `react-native-quick-crypto` requires a native development build and is
  not available in Expo Go.
- A reachable Lumen server and its Stellar co-signer public key:
  - `EXPO_PUBLIC_LUMEN_SERVER_URL`
  - `EXPO_PUBLIC_LUMEN_COSIGNER_PUBLIC_KEY`

The server URL and public key are public client configuration; never put a
sponsor secret or API secret in the Expo app.

## Install and run

Build the workspace packages before running the app so Metro can load their
compiled exports:

```powershell
pnpm --filter @lumen/core build
pnpm --filter @lumen/web-sdk build
pnpm --filter @lumen/react-native build
```

Build and install the native app with
`pnpm --filter @lumen/example-expo android` or, on macOS,
`pnpm --filter @lumen/example-expo ios`.

From the repository root, set the public API URL and the server's Stellar
co-signer public key, then start Expo:

```powershell
$env:EXPO_PUBLIC_LUMEN_SERVER_URL = "https://your-lumen-server.example"
$env:EXPO_PUBLIC_LUMEN_COSIGNER_PUBLIC_KEY = "G..."
pnpm --filter @lumen/example-expo start
```

## Expected output

Create a testnet wallet using a strong passphrase, record the displayed
recovery phrase offline, and provide a funded testnet destination to submit a
co-signed XLM payment. The passphrase encrypts the local signer before its
secret material is persisted in SecureStore. After the payment is submitted the
app shows `Co-signed transaction submitted: <hash>`.

## Screenshots

The **Lumen Native Wallet** screen shows a wallet encryption passphrase field,
the wallet address, payment destination and amount fields, a **Send co-signed
payment** button, and the recovery phrase after wallet creation.
