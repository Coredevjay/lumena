# Threat Model

This document describes the threat model for the cosigner/server architecture. It identifies the assets we protect, the actors involved, the trust boundaries between components, the attack scenarios we consider, and the mitigations mapped to features. It closes with the residual risks that remain after mitigations.

This document is informational and is intended to be reviewed alongside `SECURITY.md`. For vulnerability disclosure, see `SECURITY.md`.

## Scope

In scope:

- The cosigner/server that co-signs Stellar transactions.
- The policy engine that enforces spend, velocity, and allowlist rules.
- The signer backends (KMS/HSM/Vault) used to hold the co-signer key.
- The sponsor/fee-payer account and its key.
- The client integration (device key, passkey, session keys, JWT).
- SEP-10 authentication and replay protection.

Out of scope:

- The security of the Stellar network itself.
- The security of third-party KMS/HSM/Vault providers beyond their documented guarantees.
- The security of the user's device operating system or browser beyond the device key/passkey primitives.

## Assets

| Asset | Description | Sensitivity |
| --- | --- | --- |
| User funds | Assets held in user-controlled Stellar accounts. | Critical |
| Co-signer key | The server's signing key used to co-sign transactions. Held in KMS/HSM/Vault. | Critical |
| Fee-payer / sponsor key | Key that pays fees and creates sponsored reserves. | Critical |
| Policy configuration | Spend limits, velocity limits, allowlists, and related rules. | High |
| Session keys | Ephemeral keys used during a session. | High |
| Passkey / device key | User-held key (passkey or device-bound key) that authorizes transactions. | Critical |
| JWT signing key | Key used to sign authentication tokens. | High |
| Audit logs | Records of signing decisions, policy evaluations, and administrative actions. | High |

## Actors

| Actor | Description | Trust level |
| --- | --- | --- |
| User | Legitimate end user operating a client with their device key/passkey. | Trusted for their own funds |
| Malicious user | An authenticated user attempting to exceed policy or abuse the service. | Untrusted |
| Compromised client | A user's client that has been compromised (malware, XSS, etc.). | Untrusted |
| Compromised server | The cosigner/server has been compromised. | Untrusted |
| Compromised sponsor key | The fee-payer/sponsor key has leaked. | Untrusted |
| Compromised signer backend | The KMS/HSM/Vault holding the co-signer key has been compromised. | Untrusted |
| External attacker | An unauthenticated network attacker. | Untrusted |
| Insider | An operator with legitimate but privileged access. | Partially trusted |

## Trust boundaries

| Boundary | Description | Controls |
| --- | --- | --- |
| Client ↔ Server | Requests from the client to the cosigner/server. | SEP-10 auth, JWT, API key middleware, rate limiting, replay protection |
| Server ↔ Stellar/Horizon | The server's interaction with the Stellar network. | Transaction validation, sequence number handling, replay protection |
| Server ↔ KMS/HSM | The server's interaction with the signer backend. | Least-privilege signing keys, audit logging, key usage constraints |
| Server ↔ Sponsor account | The server's use of the sponsor/fee-payer account. | SponsorMonitorService, balance monitoring, spend limits |
| Admin ↔ Policy config | Administrative changes to policy configuration. | Authenticated admin access, audit logging, change review |

## Attack scenarios

The following scenarios describe what each compromised component **can** and **cannot** do. The core invariant is the 2-of-2 multisig: a transaction requires both the user's device signature and the server's co-signature. Neither party alone can move funds.

### Compromised server

- **Can:** Read policy configuration, observe transaction requests, attempt to co-sign arbitrary transactions, and potentially deny service.
- **Cannot:** Move user funds without the user's device signature. The server holds only one of the two required signatures. It cannot forge the user's device signature.
- **Mitigation:** 2-of-2 multisig, PolicyEngine enforcement, audit logging.

### Compromised sponsor key

- **Can:** Drain the sponsor/fee-payer account and create sponsored reserves up to available balance.
- **Cannot:** Authorize user transactions. The sponsor key is not a signer on user accounts and cannot satisfy the user's signature requirement.
- **Mitigation:** SponsorMonitorService, balance monitoring, spend limits, key rotation.

### Compromised signer backend (KMS/HSM/Vault)

- **Can:** Co-sign transactions using the co-signer key, subject to the key's usage constraints.
- **Cannot:** Move user funds without the user's device signature. It still requires the user's signature to complete a 2-of-2 transaction.
- **Mitigation:** 2-of-2 multisig, PolicyEngine enforcement, least-privilege key usage, audit logging.

### Compromised client

- **Can:** Act only within policy limits. It can request signatures for transactions that pass the PolicyEngine's spend, velocity, and allowlist checks.
- **Cannot:** Exceed policy limits, bypass the PolicyEngine, or move funds beyond what the user's device key authorizes.
- **Mitigation:** PolicyEngine spend/velocity/allowlist, 2-of-2 multisig, rate limiting.

### Malicious user

- **Can:** Attempt to exceed policy limits or abuse the service.
- **Cannot:** Exceed PolicyEngine limits or bypass authentication.
- **Mitigation:** PolicyEngine, rate limiting, API key middleware, audit logging.

### External attacker

- **Can:** Attempt unauthenticated requests, replay attacks, and credential stuffing.
- **Cannot:** Authenticate without valid credentials or replay a previously used request.
- **Mitigation:** SEP-10 auth, JWT, API key middleware, rate limiting, replay protection.

### Insider

- **Can:** Access systems and configuration within their privileges.
- **Cannot:** Move user funds without the user's device signature. Administrative actions are audited.
- **Mitigation:** Least privilege, audit logging, change review, 2-of-2 multisig.

## Mitigations mapped to features

| Threat | Mitigating feature |
| --- | --- |
| Server co-signs a malicious transaction | 2-of-2 multisig (requires user's device signature) |
| User exceeds spend limits | PolicyEngine spend limits |
| Rapid repeated spending | PolicyEngine velocity limits |
| Transactions to unknown destinations | PolicyEngine allowlist |
| Co-signer key exposure | KMS/HSM/Vault signers with least-privilege key usage |
| Unauthenticated API access | API key middleware |
| Abuse / DoS | Rate limiting |
| Sponsor account drain | SponsorMonitorService, balance monitoring |
| Impersonation / unauthenticated identity | SEP-10 authentication |
| Replayed requests | Replay protection |
| Unauthorized policy changes | Authenticated admin access, audit logging |
| Undetected malicious activity | Audit logs |

## Residual risks

After applying the mitigations above, the following risks remain:

- **User device compromise:** If the user's device key or passkey is compromised, an attacker can authorize transactions within policy limits. Device security is ultimately the user's responsibility.
- **Simultaneous compromise:** If both the server (or signer backend) and the user's device are compromised at the same time, funds can be moved. The 2-of-2 model protects against single-point compromise only.
- **Policy misconfiguration:** An overly permissive policy configuration (e.g., a wide allowlist or high limits) reduces the effectiveness of the PolicyEngine.
- **Insider with full access:** An insider with access to both the signer backend and administrative controls may be able to weaken policy, though administrative actions are audited.
- **Third-party provider compromise:** A compromise of the KMS/HSM/Vault provider beyond its documented guarantees is outside our control.
- **Sponsor account drain:** A compromised sponsor key can still drain the sponsor account, even though it cannot authorize user transactions.
- **Denial of service:** A compromised server or external attacker may cause availability issues despite rate limiting.

## Review

This threat model should be reviewed by a maintainer and updated whenever the architecture, trust boundaries, or mitigations change.