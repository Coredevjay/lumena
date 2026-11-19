# Security Best Practices for Integrators

Checklists for teams integrating `@lumen/web-sdk`, `@lumen/react`, and
`@lumen/server`. Read alongside [SECURITY.md](../../SECURITY.md) and
[Production Key Management](../production-key-management.md).

## 1. Passkey RP ID and origin binding

- [ ] Set the WebAuthn relying-party ID (`rp.id`) to the registrable domain
      that serves your app and never to a domain you do not control.
- [ ] Serve passkey registration and assertion only over HTTPS (localhost is
      the only exception during development).
- [ ] Verify `clientDataJSON.origin` against an explicit allowlist of your
      origins and check the `rpIdHash` in `authenticatorData` against
      `SHA-256(rp.id)` before trusting an assertion.
      `verifyWebAuthnAssertion` in `@lumen/core` checks the `type`, the
      challenge (when `expectedChallenge` is passed), and the signature, so do
      the origin and RP ID checks in your own code.
- [ ] Always pass `expectedChallenge` to `verifyWebAuthnAssertion` and issue a
      fresh, single-use, server-generated challenge per ceremony.
- [ ] Create passkey wallets only in the browser. `useCreateWalletWithPasskey`
      throws during SSR (`typeof window === "undefined"`); render the trigger
      inside a client component and do not call it from server code.

## 2. Content-Security-Policy

- [ ] Ship a CSP with `default-src 'self'` and avoid `'unsafe-inline'` and
      `'unsafe-eval'` in `script-src`.
- [ ] Add your Lumen server URL and Horizon / Soroban RPC endpoints to
      `connect-src` (for example `connect-src 'self' https://lumen.example.com
      https://horizon-testnet.stellar.org`).
- [ ] Set `frame-ancestors 'none'` (or a strict allowlist) so the wallet UI
      cannot be framed for clickjacking. Do not embed WebAuthn ceremonies in
      third-party iframes unless you set the `publickey-credentials-get`
      permissions policy deliberately.
- [ ] Use Subresource Integrity for any script loaded from a CDN, or bundle the
      SDK instead.

## 3. Session state storage

- [ ] Treat `localStorage` as readable by any same-origin script. `KeyManager`
      stores AES-GCM ciphertext there by default; the passphrase is never
      persisted.
- [ ] Inject a custom `KeyStorage` implementation when you need a different
      backend (for example IndexedDB with non-extractable keys or native secure
      storage via `@lumen/react-native`).
- [ ] Never persist plaintext secret keys, recovery phrases, passphrases, or
      server API secrets in browser storage, cookies, or logs.
- [ ] Keep session keys short-lived and spend-capped, and revoke them on logout.
- [ ] Prevent XSS (output encoding, CSP, dependency hygiene); it is the primary
      threat to browser-held key material.

## 4. Co-signer, fee-payer, and API key handling

- [ ] Hold the co-signer and fee-payer keys in a KMS or HSM in production
      (`AwsKmsSigner`, `GcpKmsSigner`, `VaultSigner`, `AzureKeyVaultSigner`,
      `Pkcs11Signer`). Use raw environment secrets only on testnet.
- [ ] Use separate keys for the co-signer and the fee payer, with
      least-privilege IAM and audit logging on every sign operation.
- [ ] Never ship sponsor secrets, co-signer secrets, or server API secrets to a
      client bundle. Client configuration is limited to the server URL and the
      co-signer public key.
- [ ] Keep authentication and rate limiting enabled on `@lumen/server`, and
      tune the per-client limits for `/cosign` and `/fee-bump` to your traffic.
- [ ] Configure policy rules (spend limits, velocity, allowlists, time bounds)
      for every wallet before enabling sponsorship.
- [ ] Monitor the sponsor balance and alert on policy violations through
      webhooks.

## Review

This checklist was reviewed against [SECURITY.md](../../SECURITY.md): it covers
the 2-of-2 multisig, policy enforcement, protected signing keys, and fee
sponsorship controls listed in its security model. Report suspected
vulnerabilities through the private channel described there, not through
public issues.
