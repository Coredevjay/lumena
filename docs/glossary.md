# Glossary

A reference for the terminology used throughout this project. Each entry links to the relevant guide or source file where you can learn more. For common questions, see the [FAQ](./faq.md).

---

### 2-of-2 multisig
A Stellar account configuration that requires **two** signatures to authorize a transaction — typically the user's [device key](#device-key) and a [co-signer](#co-signer) (the [sponsor account](#sponsor-account)). This is the core authorization model of the project: neither party can move funds alone. See [Architecture](./architecture.md) and the [co-sign](#co-sign) flow.

### Co-sign
The act of a second party (the [co-signer](#co-signer)) adding its signature to a transaction that the user has already signed. Co-signing is what turns a single-signature request into a valid [2-of-2 multisig](#2-of-2-multisig) transaction. See the [co-sign guide](./co-sign.md).

### Co-signer
The service or account that provides the second signature in a [2-of-2 multisig](#2-of-2-multisig) setup. The co-signer enforces the [policy engine](#policy-engine) before signing. See the [co-sign guide](./co-sign.md).

### Device key
The private key held on the user's device (often protected by a [passkey](#passkey) or secure enclave) that provides the user's signature in a [2-of-2 multisig](#2-of-2-multisig). See [Key management](./key-management.md).

### Destination allowlist
A [policy engine](#policy-engine) rule that restricts transactions to a pre-approved set of destination accounts. Transfers to any other address are rejected at [co-sign](#co-sign) time. See [Policies](./policies.md).

### Fee-bump
A Stellar transaction wrapper (fee-bump transaction) that lets one account pay the network fee on behalf of another. This is how [gasless](#gasless) transactions are achieved: the [sponsor account](#sponsor-account) wraps the user's inner transaction and pays the fee. See [Gasless transactions](./gasless.md).

### Gasless
A user experience where the end user does not need to hold or spend the native asset (XLM) to pay network fees. Fees are covered by the [sponsor account](#sponsor-account) via a [fee-bump](#fee-bump) transaction. See [Gasless transactions](./gasless.md).

### Horizon
The HTTP API server for the Stellar network, used to submit transactions and query account state. See the [Stellar documentation](https://developers.stellar.org/docs/data/apis/horizon) and [Architecture](./architecture.md).

### JWT
JSON Web Token — a signed, compact token used for authenticating API requests to the co-signer service. See [Authentication](./authentication.md).

### KMS/HSM
Key Management Service / Hardware Security Module — secure systems used to store and operate on the [co-signer](#co-signer)'s signing keys. See [Key management](./key-management.md).

### Passkey
A WebAuthn credential (e.g. biometric or platform authenticator) used to protect and authorize use of the [device key](#device-key). See [Key management](./key-management.md).

### Policy engine
The component that evaluates every transaction request against a set of rules (such as [spend limits](#spend-limit), [velocity rules](#velocity-rule), and the [destination allowlist](#destination-allowlist)) before the [co-signer](#co-signer) signs. See [Policies](./policies.md).

### Replay attack
An attack where a valid signed transaction or request is captured and resubmitted. Mitigated here via nonces, sequence numbers, and short-lived [JWTs](#jwt). See [Security](./security.md).

### Reserve
The minimum XLM balance a Stellar account must maintain (base reserve plus per-entry reserves). Relevant when provisioning accounts and estimating costs. See the [Stellar documentation](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#minimum-balance) and [Architecture](./architecture.md).

### Seedless
A wallet design where the user never handles or stores a raw secret seed / mnemonic phrase. Key material is instead derived from a [passkey](#passkey) or held in a [device key](#device-key), removing the classic "write down your seed phrase" burden. See [Seedless onboarding](./seedless.md).

### SEP-10
Stellar Ecosystem Proposal 10 — the standard for authenticating to a Stellar service via a challenge transaction signed by the user's key. Used to establish the session that authorizes [co-sign](#co-sign) requests. See [Authentication](./authentication.md).

### Session key
A short-lived key authorized to act on behalf of the user for a limited scope and duration, reducing how often the primary [device key](#device-key) must be used. See [Key management](./key-management.md).

### Signer backend
The pluggable component responsible for producing signatures for the [co-signer](#co-signer). Backends may be software keys, [KMS/HSM](#kmshsm), or other providers. See [Key management](./key-management.md).

### Soroban
Stellar's smart contract platform. Relevant where on-chain policy or account logic is implemented as contracts. See the [Soroban documentation](https://developers.stellar.org/docs/build/smart-contracts/overview).

### Spend limit
A [policy engine](#policy-engine) rule capping the amount a user may transfer within a given period. See [Policies](./policies.md).

### Sponsor account
The account operated by the service that acts as the [co-signer](#co-signer) and pays network fees via [fee-bump](#fee-bump). It is the second signer in the [2-of-2 multisig](#2-of-2-multisig). See [Architecture](./architecture.md).

### Sponsorship
The arrangement where the [sponsor account](#sponsor-account) covers costs on behalf of the user — both network fees ([gasless](#gasless)) and, where applicable, Stellar reserve sponsorship. See [Gasless transactions](./gasless.md).

### Stellar
The public blockchain network this project builds on, providing accounts, assets, and the [2-of-2 multisig](#2-of-2-multisig) authorization model. See the [Stellar documentation](https://developers.stellar.org/docs).

### Velocity rule
A [policy engine](#policy-engine) rule limiting how frequently or how much can be transacted over a rolling window (e.g. per hour or per day), complementing the [spend limit](#spend-limit). See [Policies](./policies.md).

---

Missing a term? Open an issue or check the [FAQ](./faq.md) for common questions.