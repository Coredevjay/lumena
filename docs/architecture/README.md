# Architecture

The architecture of Lumen, with [Mermaid](https://mermaid.js.org) diagrams that
render both on GitHub and in the Starlight docs site (rendered client-side via
the Mermaid 11 ES module configured in `docs/astro.config.mjs`).

Every diagram is maintained against the current code in
`packages/server/src` (cosigner, policy engine, fee sponsor) and
`contracts/` (on-chain paymaster and policy contracts). When you change one of
those components, update the matching diagram in the same pull request.

## Pages and diagrams

| Page | What it covers | Diagrams |
|---|---|---|
| [Gasless fee-bump](./gasless-transactions.md) | How the user's inner transaction is co-signed, wrapped in a fee-bump envelope, and submitted without user-paid fees; sponsor account pool, drain mode, rotation, and the on-chain Paymaster contract | C4 system context, C4 containers, cosign + fee-bump sequence diagram |
| [Multisig](./multisig.md) | The 2-of-2 user/server multisig scheme and the approval flow for wallet transactions | C4 containers, approval sequence diagram |
| [Policy engine](./policy-engine.md) | Spend, velocity, allowlist, time-bound, and session-key rules evaluated before co-signing, plus the on-chain policy contracts that mirror them | — (text) |
| [Wallet lifecycle](./wallet-lifecycle.md) | Wallet creation, activation, use, and social recovery, including tenant/network binding | Wallet state diagram, recovery sequence diagram, network resolution flowchart |

## Where to start

- To understand a user transaction end to end, read the
  [cosign and fee-bump sequence](./gasless-transactions.md#cosign-and-fee-bump-sequence).
- To understand who signs what and why two signatures are required, read
  [multisig](./multisig.md).
- To understand what the server checks before adding its signature, read
  [policy engine](./policy-engine.md).
- To understand how wallets are created, recovered, and bound to a network,
  read [wallet lifecycle](./wallet-lifecycle.md).
