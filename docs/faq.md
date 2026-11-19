# Frequently Asked Questions (FAQ)

This FAQ answers common questions about the seedless, gasless Stellar wallet. For definitions of terms used here, see the [Glossary](./glossary.md). For security details, see the [Threat Model](./threat-model.md). For operational procedures, see the [Runbooks](./runbooks/README.md). For step-by-step instructions, see the [Guides](./guides/README.md).

> **New here?** Start with the [Glossary](./glossary.md), then read the [Threat Model](./threat-model.md) and the [Guides](./guides/README.md).

---

## 1. What does "seedless" mean?

"Seedless" means the user never handles or stores a raw Stellar secret key (seed). Instead, key material is split between the client and a co-signing server, and transactions are authorized through a [2-of-2 co-signing](./glossary.md#2-of-2-co-signing) flow. The user authenticates with their normal credentials rather than managing a seed phrase. See [Glossary: Seedless](./glossary.md#seedless) and the [Threat Model](./threat-model.md).

## 2. What does "gasless" mean?

"Gasless" means the user does not need to hold XLM to pay transaction fees. A [sponsor](./glossary.md#sponsorship) account pays the network fees (and, where applicable, reserves) on the user's behalf. See [Glossary: Gasless](./glossary.md#gasless) and [Glossary: Sponsorship](./glossary.md#sponsorship).

## 3. How does sponsorship work?

A sponsor account funds transaction fees and, optionally, account reserves via Stellar's [sponsored reserves](./glossary.md#sponsored-reserve) mechanism. When a user submits a transaction, the [co-signer](./glossary.md#co-signer) attaches the sponsor's fee-bump or sponsorship envelope so the user pays nothing. Operational details are in the [Sponsorship Runbook](./runbooks/sponsorship.md). See also [Glossary: Sponsorship](./glossary.md#sponsorship).

## 4. What happens if the co-signing server is compromised?

The server holds only one share of the [2-of-2](./glossary.md#2-of-2-co-signing) key and enforces [spend limits](./glossary.md#spend-limit) and policy checks. A compromised server alone cannot move funds beyond configured limits without the client's share, and all actions are logged and auditable. The full analysis is in the [Threat Model](./threat-model.md); incident response is in the [Incident Response Runbook](./runbooks/incident-response.md). See [Glossary: Co-signer](./glossary.md#co-signer).

## 5. How does 2-of-2 co-signing protect users?

Every transaction requires signatures from both the client share and the server share. Neither party can authorize a transaction alone, so a stolen client device or a compromised server is insufficient on its own. See [Glossary: 2-of-2 Co-signing](./glossary.md#2-of-2-co-signing) and the [Threat Model](./threat-model.md).

## 6. How do I configure spend limits?

Spend limits are enforced by the co-signer and configured per account or per policy. Set them via the configuration described in the [Configuration Guide](./guides/configuration.md) and the [Spend Limits Runbook](./runbooks/spend-limits.md). See [Glossary: Spend Limit](./glossary.md#spend-limit).

## 7. How do I rotate the co-signer key?

Key rotation is a documented operational procedure: generate a new share, re-register it with the client, and retire the old share. Follow the [Key Rotation Runbook](./runbooks/key-rotation.md). See [Glossary: Key Rotation](./glossary.md#key-rotation) and [Glossary: Co-signer](./glossary.md#co-signer).

## 8. How do fee-bumps work?

When the network fee is too low, a [fee-bump](./glossary.md#fee-bump) transaction wraps the original and pays a higher fee, signed by the sponsor. The inner transaction's signatures remain valid. See [Glossary: Fee-bump](./glossary.md#fee-bump) and the [Sponsorship Runbook](./runbooks/sponsorship.md).

## 9. What happens if the sponsor runs out of XLM?

New gasless transactions will fail until the sponsor is refunded, because fees cannot be paid. Monitor sponsor balances via the alerting described in the [Sponsorship Runbook](./runbooks/sponsorship.md) and top up promptly. See [Glossary: Sponsorship](./glossary.md#sponsorship) and [Glossary: Gasless](./glossary.md#gasless).

## 10. How does SEP-10 authentication work?

[SEP-10](./glossary.md#sep-10) is Stellar's standard web authentication protocol. The client requests a challenge from the server, signs it with its key share, and receives a JWT used to authorize co-signing requests. See [Glossary: SEP-10](./glossary.md#sep-10) and the [Authentication Guide](./guides/authentication.md).

## 11. How do I run the project locally?

Clone the repository, install dependencies, configure environment variables, and start the client and server per the [Local Development Guide](./guides/local-development.md). See also the [Configuration Guide](./guides/configuration.md).

## 12. How do I report a vulnerability?

Do **not** open a public issue. Follow the responsible disclosure process in [SECURITY.md](../SECURITY.md) and the [Incident Response Runbook](./runbooks/incident-response.md). See the [Threat Model](./threat-model.md) for the security model.

## 13. What is a co-signer?

The [co-signer](./glossary.md#co-signer) is the server-side component that holds one key share, enforces policy, and co-signs transactions. See [Glossary: Co-signer](./glossary.md#co-signer).

## 14. What is a sponsored reserve?

A [sponsored reserve](./glossary.md#sponsored-reserve) is the minimum XLM balance an account must hold, paid by a sponsor rather than the user. See [Glossary: Sponsored Reserve](./glossary.md#sponsored-reserve) and the [Sponsorship Runbook](./runbooks/sponsorship.md).

## 15. What is a spend limit?

A [spend limit](./glossary.md#spend-limit) is a policy cap on how much value a co-signer will authorize over a period. See [Glossary: Spend Limit](./glossary.md#spend-limit) and the [Spend Limits Runbook](./runbooks/spend-limits.md).

## 16. What is key rotation?

[Key rotation](./glossary.md#key-rotation) is the process of replacing a key share with a new one while preserving account control. See [Glossary: Key Rotation](./glossary.md#key-rotation) and the [Key Rotation Runbook](./runbooks/key-rotation.md).

## 17. What is a fee-bump transaction?

A [fee-bump](./glossary.md#fee-bump) is a wrapper transaction that pays a higher fee for an inner transaction, typically funded by the sponsor. See [Glossary: Fee-bump](./glossary.md#fee-bump).

## 18. What is SEP-10?

[SEP-10](./glossary.md#sep-10) is the Stellar Ecosystem Proposal defining standard web authentication via signed challenges. See [Glossary: SEP-10](./glossary.md#sep-10) and the [Authentication Guide](./guides/authentication.md).

## 19. Where can I find the security model?

See the [Threat Model](./threat-model.md) for assets, adversaries, and mitigations, and [SECURITY.md](../SECURITY.md) for reporting. Related terms are in the [Glossary](./glossary.md).

## 20. Where are the operational procedures?

All operational procedures live in the [Runbooks](./runbooks/README.md), including [Sponsorship](./runbooks/sponsorship.md), [Key Rotation](./runbooks/key-rotation.md), [Spend Limits](./runbooks/spend-limits.md), and [Incident Response](./runbooks/incident-response.md).

## 21. Where are the step-by-step guides?

See the [Guides](./guides/README.md), including [Local Development](./guides/local-development.md), [Configuration](./guides/configuration.md), and [Authentication](./guides/authentication.md).

## 22. Where is the glossary?

The [Glossary](./glossary.md) defines seedless, gasless, sponsorship, 2-of-2 co-signing, co-signer, spend limits, key rotation, fee-bumps, SEP-10, and more.

---

**Related documents:** [Glossary](./glossary.md) · [Threat Model](./threat-model.md) · [Runbooks](./runbooks/README.md) · [Guides](./guides/README.md) · [Security Policy](../SECURITY.md)