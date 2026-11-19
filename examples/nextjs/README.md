# Next.js Example

## Overview

Minimal `@lumen/react` integration for App Router projects. The page wraps a
`LumenClient` in `LumenProvider` and `LumenThemeProvider` and uses `useWallet`
to create a wallet.

## Prerequisites

- Node.js 20+ and pnpm
- A running `@lumen/server` (defaults to `http://localhost:3000`)
- Built workspace packages: `pnpm --filter @lumen/react build` and
  `pnpm --filter @lumen/web-sdk build`

## Install and run

```bash
pnpm install
NEXT_PUBLIC_LUMEN_SERVER_URL=http://localhost:3000 pnpm --filter @lumen/example-nextjs dev
```

Open `http://localhost:3000` (or the port Next.js prints if the server already
uses 3000).

## Expected output

Clicking **Create wallet** calls `wallet.createWallet()` and the page prints a
JSON block with the new wallet `address`, or an `error` message if the server is
unreachable.

## Screenshots

A single **Create wallet** button above a JSON panel showing `address` and
`error`.
