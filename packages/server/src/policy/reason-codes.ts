/**
 * Stable, documented reason codes returned alongside policy denial messages.
 *
 * Every policy rule that can deny a transaction returns exactly one of these
 * codes so that clients (web SDK, CLI, dashboards) can branch on a stable
 * identifier instead of parsing human-readable messages.
 */
export const POLICY_REASON_CODES = [
  /** A spend limit rule rejected the transaction amount. */
  "SPEND_LIMIT_EXCEEDED",
  /** A velocity rule rejected the transaction count within the window. */
  "VELOCITY_LIMIT_EXCEEDED",
  /** An allowlist rule rejected a destination that is not permitted. */
  "DESTINATION_NOT_ALLOWED",
  /** A blocklist rule rejected a destination that is explicitly blocked. */
  "DESTINATION_BLOCKED",
  /** An asset allowlist rule rejected an asset that is not permitted. */
  "ASSET_NOT_ALLOWED",
  /** A session key rule rejected the invocation or spend. */
  "SESSION_KEY_VIOLATION",
  /** A timebounds rule rejected the transaction's validity window. */
  "TIMEBOUNDS_VIOLATION",
  /** A max operations rule rejected the operation count. */
  "MAX_OPERATIONS_EXCEEDED",
  /** A fee limit rule rejected the transaction fee. */
  "FEE_LIMIT_EXCEEDED",
  /** A contract allowlist rule rejected a contract invocation. */
  "CONTRACT_NOT_ALLOWED",
  /** The rule itself was malformed and could not be evaluated. */
  "MALFORMED_RULE",
  /** The rule type is not recognised by this engine version. */
  "UNKNOWN_RULE_TYPE",
  /** No policy is configured for the wallet and the default is deny. */
  "NO_POLICY",
  /** The stored policy has malformed rules. */
  "MALFORMED_POLICY",
  /** Evaluation options were malformed. */
  "MALFORMED_OPTIONS",
  /** Evaluation threw and the engine failed closed. */
  "EVALUATION_ERROR",
] as const;

export type PolicyReasonCode = (typeof POLICY_REASON_CODES)[number];

/** Human-readable description for each reason code, used in the OpenAPI docs. */
export const POLICY_REASON_CODE_DESCRIPTIONS: Record<PolicyReasonCode, string> = {
  SPEND_LIMIT_EXCEEDED: "The transaction amount exceeds the configured spend limit.",
  VELOCITY_LIMIT_EXCEEDED: "Too many transactions within the configured velocity window.",
  DESTINATION_NOT_ALLOWED: "The destination is not on the policy allowlist.",
  DESTINATION_BLOCKED: "The destination is on the policy blocklist.",
  ASSET_NOT_ALLOWED: "The asset is not on the policy asset allowlist.",
  SESSION_KEY_VIOLATION: "The session key is not permitted to perform this operation.",
  TIMEBOUNDS_VIOLATION: "The transaction timebounds violate the policy window.",
  MAX_OPERATIONS_EXCEEDED: "The transaction has more operations than the policy allows.",
  FEE_LIMIT_EXCEEDED: "The transaction fee exceeds the configured fee limit.",
  CONTRACT_NOT_ALLOWED: "The invoked contract is not on the policy contract allowlist.",
  MALFORMED_RULE: "The policy rule is malformed and could not be evaluated.",
  UNKNOWN_RULE_TYPE: "The policy rule type is not recognised by this engine version.",
  NO_POLICY: "No policy is configured for the wallet and the default decision is deny.",
  MALFORMED_POLICY: "The stored policy has malformed rules.",
  MALFORMED_OPTIONS: "The evaluation options were malformed.",
  EVALUATION_ERROR: "Policy evaluation failed and the engine failed closed.",
};
