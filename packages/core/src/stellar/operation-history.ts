/**
 * Turns raw Horizon operation records into human-readable history events
 * (e.g. "Sent 10 USDC to GABC…WXYZ").
 */

/** A Horizon operation record as returned by `/accounts/:id/operations`. */
export interface HorizonOperationRecord {
  type: string;
  [key: string]: unknown;
}

export type OperationDirection = "incoming" | "outgoing" | "self" | "none";

export interface DescribeOperationOpts {
  /** The account whose point of view determines the direction. */
  account?: string;
}

export interface OperationDescription {
  /** The raw Horizon operation type, e.g. `payment`. */
  type: string;
  direction: OperationDirection;
  amount: string | null;
  assetCode: string | null;
  counterparty: string | null;
  memo: string | null;
  /** One-line human-readable description of the operation. */
  summary: string;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

function assetCodeOf(assetType: unknown, assetCode: unknown): string | null {
  if (assetType === "native") return "XLM";
  return str(assetCode);
}

/** Parses Horizon's `"native"` / `"CODE:ISSUER"` asset strings. */
function assetCodeFromString(asset: unknown): string | null {
  const value = str(asset);
  if (!value) return null;
  if (value === "native") return "XLM";
  return value.split(":")[0] ?? null;
}

function directionOf(
  from: string | null,
  to: string | null,
  account: string | undefined,
): OperationDirection {
  if (!account) return "none";
  if (from === account && to === account) return "self";
  if (from === account) return "outgoing";
  if (to === account) return "incoming";
  return "none";
}

function memoOf(op: HorizonOperationRecord): string | null {
  const tx = op.transaction;
  if (tx && typeof tx === "object") {
    const memo = str((tx as Record<string, unknown>).memo);
    if (memo) return memo;
  }
  return str(op.memo);
}

function transferSummary(
  direction: OperationDirection,
  amount: string | null,
  assetCode: string | null,
  from: string | null,
  to: string | null,
): string {
  const value = [amount, assetCode].filter(Boolean).join(" ");
  if (direction === "incoming") return `Received ${value}${from ? ` from ${shortAddress(from)}` : ""}`;
  if (direction === "self") return `Sent ${value} to self`;
  if (direction === "outgoing") return `Sent ${value}${to ? ` to ${shortAddress(to)}` : ""}`;
  return `Transferred ${value}${from ? ` from ${shortAddress(from)}` : ""}${to ? ` to ${shortAddress(to)}` : ""}`;
}

/**
 * Describes a single Horizon operation from the point of view of `account`.
 *
 * Supports payments, path payments, trustlines, claimable balances and
 * Soroban contract invocations; other types get a generic description.
 */
export function describeOperation(
  op: HorizonOperationRecord,
  opts: DescribeOperationOpts = {},
): OperationDescription {
  const { account } = opts;
  const type = op.type;
  const memo = memoOf(op);
  const source = str(op.source_account);

  switch (type) {
    case "payment": {
      const from = str(op.from) ?? source;
      const to = str(op.to);
      const direction = directionOf(from, to, account);
      const amount = str(op.amount);
      const assetCode = assetCodeOf(op.asset_type, op.asset_code);
      return {
        type,
        direction,
        amount,
        assetCode,
        counterparty: direction === "incoming" ? from : to,
        memo,
        summary: transferSummary(direction, amount, assetCode, from, to),
      };
    }

    case "path_payment_strict_send":
    case "path_payment_strict_receive": {
      const from = str(op.from) ?? source;
      const to = str(op.to);
      const direction = directionOf(from, to, account);
      const amount = str(op.amount);
      const assetCode = assetCodeOf(op.asset_type, op.asset_code);
      const sourceAmount = str(op.source_amount);
      const sourceAssetCode = assetCodeOf(op.source_asset_type, op.source_asset_code);
      const paid = [sourceAmount, sourceAssetCode].filter(Boolean).join(" ");
      const summary =
        direction === "self"
          ? `Swapped ${paid} for ${[amount, assetCode].filter(Boolean).join(" ")}`
          : direction === "outgoing" && paid
            ? `${transferSummary(direction, amount, assetCode, from, to)} (paid ${paid})`
            : transferSummary(direction, amount, assetCode, from, to);
      return {
        type,
        direction,
        // From the sender's side the debited amount is the source amount.
        amount: direction === "outgoing" ? (sourceAmount ?? amount) : amount,
        assetCode: direction === "outgoing" ? (sourceAssetCode ?? assetCode) : assetCode,
        counterparty: direction === "incoming" ? from : to,
        memo,
        summary,
      };
    }

    case "change_trust": {
      const assetCode = assetCodeOf(op.asset_type, op.asset_code);
      const removed = str(op.limit) !== null && Number(op.limit) === 0;
      return {
        type,
        direction: "none",
        amount: removed ? null : str(op.limit),
        assetCode,
        counterparty: str(op.asset_issuer) ?? str(op.trustee),
        memo,
        summary: `${removed ? "Removed" : "Added"} trustline for ${assetCode ?? "asset"}`,
      };
    }

    case "create_claimable_balance": {
      const amount = str(op.amount);
      const assetCode = assetCodeFromString(op.asset);
      const claimants = Array.isArray(op.claimants)
        ? op.claimants
            .map((c) => (c && typeof c === "object" ? str((c as Record<string, unknown>).destination) : null))
            .filter((d): d is string => d !== null)
        : [];
      const incoming =
        account !== undefined && account !== source && claimants.includes(account);
      const direction: OperationDirection = !account
        ? "none"
        : incoming
          ? "incoming"
          : source === account
            ? "outgoing"
            : "none";
      const recipient = claimants.find((c) => c !== source) ?? claimants[0] ?? null;
      const counterparty = incoming ? source : recipient;
      const value = [amount, assetCode].filter(Boolean).join(" ");
      return {
        type,
        direction,
        amount,
        assetCode,
        counterparty,
        memo,
        summary: incoming
          ? `Claimable balance of ${value}${source ? ` from ${shortAddress(source)}` : ""}`
          : `Created claimable balance of ${value}${recipient ? ` for ${shortAddress(recipient)}` : ""}`,
      };
    }

    case "claim_claimable_balance": {
      const claimant = str(op.claimant) ?? source;
      return {
        type,
        direction: account && claimant === account ? "incoming" : "none",
        amount: null,
        assetCode: null,
        counterparty: null,
        memo,
        summary: "Claimed claimable balance",
      };
    }

    case "invoke_host_function": {
      const changes = Array.isArray(op.asset_balance_changes)
        ? (op.asset_balance_changes.filter((c) => c && typeof c === "object") as Record<
            string,
            unknown
          >[])
        : [];
      const change =
        changes.find((c) => account && (c.from === account || c.to === account)) ?? changes[0];
      if (!change) {
        return {
          type,
          direction: "none",
          amount: null,
          assetCode: null,
          counterparty: null,
          memo,
          summary: "Invoked contract",
        };
      }
      const from = str(change.from);
      const to = str(change.to);
      const direction = directionOf(from, to, account);
      const amount = str(change.amount);
      const assetCode = assetCodeOf(change.asset_type, change.asset_code);
      return {
        type,
        direction,
        amount,
        assetCode,
        counterparty: direction === "incoming" ? from : to,
        memo,
        summary: `${transferSummary(direction, amount, assetCode, from, to)} via contract`,
      };
    }

    default:
      return {
        type,
        direction: account && source === account ? "outgoing" : "none",
        amount: null,
        assetCode: null,
        counterparty: null,
        memo,
        summary: type.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      };
  }
}
