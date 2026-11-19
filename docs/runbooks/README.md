# Runbooks

Operational runbooks for responding to production alerts. Each alert in
`docker/prometheus/alerts.yml` links to one of these pages via its `runbook_url`
annotation.

## Index

| Runbook | Primary alerts | Severity |
| --- | --- | --- |
| [Sponsor Balance Depletion](sponsor-balance-depletion.md) | `SponsorBalanceCritical`, `SponsorBalanceLow` | Critical / Warning |
| [Horizon Outage](horizon-outage.md) | `RPCLatencySpike`, `HorizonUnavailable` | Critical / Warning |
| [Signer Failure](signer-failure.md) | `CosignErrorRateHigh`, `SignerUnavailable` | Critical / Warning |
| [Replay / Fraud](replay-fraud.md) | `PolicyLatencySpike`, `ReplayDetected`, `FraudAlert` | Critical / Warning |

## How to use a runbook

1. Open the runbook linked from the firing alert's `runbook_url` annotation.
2. Follow the **Remediation** steps in order. Commands assume you have
   `kubectl`, `stellar`, and `curl` configured against the production cluster
   and that `$SPONSOR_SECRET` / `$SIGNER_TOKEN` are exported from the secrets
   manager.
3. Record actions taken in the incident channel and in the incident ticket.
4. After resolution, complete the **Post-incident review** section of the
   runbook and update the **Drill verification** table.

## Conventions

- **Severity** follows the alert's `severity` label (`critical` pages on-call,
  `warning` files a ticket).
- **Escalation** contacts are listed per runbook. If the primary does not
  acknowledge within 15 minutes, escalate to the secondary.
- **Drill verification**: every runbook must record the date and outcome of the
  last drill. A runbook with a drill older than 90 days is considered stale and
  must be re-verified.

## Adding a runbook

1. Copy an existing runbook as a template.
2. Fill in alert name, severity, symptoms, impact, remediation, escalation, and
   drill verification.
3. Add a row to the index above.
4. Add a `runbook_url` annotation to the corresponding alert in
   `docker/prometheus/alerts.yml`.
5. Run a drill and record the outcome.