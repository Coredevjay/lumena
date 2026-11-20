# Lumen Examples

The root package is named `lumen` and uses `pnpm -r` for workspace scripts.

Runnable examples for the Lumen SDKs. Run every command from the repository
root after `pnpm install`.

| Example | What it demonstrates | How to run | Docs |
|---|---|---|---|
| `expo` | Native BIP-39 key generation, SecureStore persistence, and a co-signed testnet payment with `@lumen/react-native` | `pnpm --filter @lumen/example-expo start` | [README](./expo/README.md) |
| `nextjs` | Minimal `@lumen/react` App Router integration (`LumenProvider`, `useWallet`) | `pnpm --filter @lumen/example-nextjs dev` | [README](./nextjs/README.md) |
| `node` | Server-side `@lumen/core` setup with a Stellar testnet keypair | `pnpm --filter @lumen/example-node start` | [README](./node/README.md) |
| `playground` | Seedless onboarding, gasless payments, and policy enforcement with `@lumen/web-sdk` and `@lumen/server` | `pnpm --filter playground dev` | [README](./playground/README.md) |
| `session-keys` | Scoped, time-limited session keys for prompt-free micropayments | `pnpm --filter session-keys dev` | [README](./session-keys/README.md) |

## README template

Each example README follows the same structure:

1. **Overview** – what the example demonstrates.
2. **Prerequisites** – tools, services, and environment variables it needs.
3. **Install and run** – the exact commands to start it.
4. **Expected output** – what you should see when it works.
5. **Screenshots** – what the main screen shows.
