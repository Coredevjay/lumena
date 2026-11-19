/**
 * Maps Horizon / Soroban transaction and operation result codes to typed,
 * user-friendly errors.
 */

export interface ParsedResultCode {
  /** Normalized result code, e.g. `op_underfunded` or `tx_bad_auth`. */
  code: string;
  /** Index of the failing operation, or `null` for transaction-level codes. */
  operationIndex: number | null;
  /** Human-readable description of the failure. */
  message: string;
  /** Suggested next step for the user or developer. */
  hint: string;
}

interface ResultCodeInfo {
  message: string;
  hint: string;
}

export const RESULT_CODE_MESSAGES: Record<string, ResultCodeInfo> = {
  // Transaction-level codes
  tx_failed: {
    message: "One or more operations failed.",
    hint: "Inspect the operation result codes for the specific failure.",
  },
  tx_too_early: {
    message: "The transaction's time bounds have not started yet.",
    hint: "Wait until the minimum time bound or rebuild the transaction.",
  },
  tx_too_late: {
    message: "The transaction has expired.",
    hint: "Rebuild and re-sign the transaction with a new timeout.",
  },
  tx_missing_operation: {
    message: "The transaction has no operations.",
    hint: "Add at least one operation before submitting.",
  },
  tx_bad_seq: {
    message: "The sequence number does not match the source account.",
    hint: "Reload the source account and rebuild the transaction.",
  },
  tx_bad_auth: {
    message: "The transaction is missing required signatures or has invalid ones.",
    hint: "Check that every required signer has signed and the network passphrase is correct.",
  },
  tx_insufficient_balance: {
    message: "The fee would bring the source account below its minimum reserve.",
    hint: "Fund the source account with more XLM.",
  },
  tx_no_account: {
    message: "The source account does not exist.",
    hint: "Create and fund the source account first.",
  },
  tx_insufficient_fee: {
    message: "The fee is too low for current network conditions.",
    hint: "Increase the fee and resubmit.",
  },
  tx_bad_auth_extra: {
    message: "The transaction has unused signatures.",
    hint: "Remove signatures that are not required.",
  },
  tx_internal_error: {
    message: "An unknown internal error occurred in the network.",
    hint: "Retry the submission later.",
  },
  tx_not_supported: {
    message: "The transaction type is not supported by the network.",
    hint: "Check the protocol version of the network you are submitting to.",
  },
  tx_fee_bump_inner_failed: {
    message: "The inner transaction of the fee bump failed.",
    hint: "Inspect the inner transaction result codes for the specific failure.",
  },
  tx_bad_sponsorship: {
    message: "A sponsorship was not properly closed.",
    hint: "Pair every begin-sponsoring operation with an end-sponsoring operation.",
  },
  tx_bad_min_seq_age_or_gap: {
    message: "The minimum sequence age or gap precondition was not met.",
    hint: "Wait for the precondition to be satisfied or rebuild the transaction.",
  },
  tx_malformed: {
    message: "The transaction is malformed.",
    hint: "Rebuild the transaction and check its preconditions.",
  },
  tx_soroban_invalid: {
    message: "The Soroban transaction data is invalid.",
    hint: "Re-simulate the transaction and apply the returned resources before signing.",
  },

  // Operation-level codes
  op_inner: {
    message: "The operation failed.",
    hint: "Inspect the operation details for the specific failure.",
  },
  op_bad_auth: {
    message: "The operation is missing required signatures.",
    hint: "Check that the operation source account has signed.",
  },
  op_no_source_account: {
    message: "The operation source account does not exist.",
    hint: "Create and fund the operation source account first.",
  },
  op_not_supported: {
    message: "The operation is not supported by the network.",
    hint: "Check the protocol version of the network you are submitting to.",
  },
  op_too_many_subentries: {
    message: "The account has reached its subentry limit.",
    hint: "Remove unused trustlines, offers or data entries.",
  },
  op_exceeded_work_limit: {
    message: "The operation exceeded the network work limit.",
    hint: "Split the work into smaller operations.",
  },
  op_too_many_sponsoring: {
    message: "The account is sponsoring too many entries.",
    hint: "Reduce the number of sponsored entries.",
  },
  op_malformed: {
    message: "The operation is malformed.",
    hint: "Check the operation parameters (amounts, assets, addresses).",
  },
  op_underfunded: {
    message: "The source account does not have enough funds.",
    hint: "Fund the account or reduce the amount.",
  },
  op_src_no_trust: {
    message: "The source account does not trust the asset being sent.",
    hint: "Add a trustline for the asset on the source account.",
  },
  op_src_not_authorized: {
    message: "The source account is not authorized to send this asset.",
    hint: "Ask the asset issuer to authorize the source account.",
  },
  op_no_destination: {
    message: "The destination account does not exist.",
    hint: "Create the destination account first or send enough XLM to create it.",
  },
  op_no_trust: {
    message: "The destination account does not trust the asset.",
    hint: "The recipient must add a trustline for the asset before receiving it.",
  },
  op_not_authorized: {
    message: "The destination account is not authorized to hold this asset.",
    hint: "Ask the asset issuer to authorize the destination account.",
  },
  op_line_full: {
    message: "The destination trustline limit would be exceeded.",
    hint: "The recipient must raise their trustline limit.",
  },
  op_no_issuer: {
    message: "The asset issuer does not exist.",
    hint: "Check the asset code and issuer address.",
  },
  op_already_exists: {
    message: "The account already exists.",
    hint: "Use a payment instead of creating the account.",
  },
  op_low_reserve: {
    message: "The account would fall below its minimum reserve.",
    hint: "Fund the account with more XLM.",
  },
  op_too_few_offers: {
    message: "No path was found to complete the path payment.",
    hint: "Try a different path or a smaller amount.",
  },
  op_over_source_max: {
    message: "The path payment would cost more than the maximum allowed.",
    hint: "Increase the maximum send amount or retry later.",
  },
  op_under_dest_min: {
    message: "The path payment would deliver less than the minimum required.",
    hint: "Lower the minimum destination amount or retry later.",
  },
  op_cross_self: {
    message: "The offer would cross an offer from the same account.",
    hint: "Cancel or adjust your existing offer.",
  },
  op_invalid_limit: {
    message: "The trustline limit is below the current balance or liabilities.",
    hint: "Set a limit greater than or equal to the current balance.",
  },
  op_trapped: {
    message: "The contract invocation trapped.",
    hint: "Check the contract diagnostic events for the cause.",
  },
  op_resource_limit_exceeded: {
    message: "The contract invocation exceeded its resource limits.",
    hint: "Re-simulate the transaction and apply the returned resources.",
  },
  op_entry_archived: {
    message: "A contract ledger entry has been archived.",
    hint: "Restore the archived entry before invoking the contract.",
  },
  op_insufficient_refundable_fee: {
    message: "The refundable fee is too low for the contract invocation.",
    hint: "Re-simulate the transaction and increase the resource fee.",
  },
};

/** Normalizes `txBAD_SEQ` / `TX_BAD_SEQ` style codes to `tx_bad_seq`. */
function normalizeCode(code: string): string {
  return code.replace(/^(tx|op)(?=[A-Z])/, "$1_").toLowerCase();
}

function toParsedResultCode(code: string, operationIndex: number | null): ParsedResultCode {
  const normalized = normalizeCode(code);
  const info = RESULT_CODE_MESSAGES[normalized];
  return {
    code: normalized,
    operationIndex,
    message: info?.message ?? `Transaction failed with result code ${normalized}.`,
    hint: info?.hint ?? "Check the Stellar result code documentation for details.",
  };
}

function extractResultCodes(
  input: unknown,
): { transaction?: unknown; operations?: unknown } | null {
  if (typeof input !== "object" || input === null) return null;
  const anyInput = input as any;
  const candidates = [
    anyInput.response?.data?.extras?.result_codes,
    anyInput.data?.extras?.result_codes,
    anyInput.extras?.result_codes,
    anyInput.result_codes,
    anyInput,
  ];
  for (const candidate of candidates) {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      (typeof candidate.transaction === "string" || Array.isArray(candidate.operations))
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Parses result codes from a Horizon submission error, its response body, or
 * a raw `result_codes` object. When the transaction failed because of an
 * operation, the first failing operation is reported. Returns `null` when no
 * result codes are present.
 */
export function parseResultCodes(input: unknown): ParsedResultCode | null {
  const resultCodes = extractResultCodes(input);
  if (!resultCodes) return null;

  const operations = Array.isArray(resultCodes.operations) ? resultCodes.operations : [];
  const failedIndex = operations.findIndex(
    (op) => typeof op === "string" && normalizeCode(op) !== "op_success",
  );
  if (failedIndex !== -1) {
    return toParsedResultCode(operations[failedIndex] as string, failedIndex);
  }

  if (typeof resultCodes.transaction === "string") {
    return toParsedResultCode(resultCodes.transaction, null);
  }
  return null;
}

/** Error thrown when a transaction is rejected with a known result code. */
export class StellarResultError extends Error {
  public readonly code: string;
  public readonly operationIndex: number | null;
  public readonly hint: string;

  constructor(parsed: ParsedResultCode) {
    super(parsed.message);
    this.name = "StellarResultError";
    this.code = parsed.code;
    this.operationIndex = parsed.operationIndex;
    this.hint = parsed.hint;
    Object.setPrototypeOf(this, StellarResultError.prototype);
  }
}
