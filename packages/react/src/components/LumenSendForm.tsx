import React, { useCallback, useId, useState } from "react";
import { Federation, StrKey } from "@stellar/stellar-sdk";

export type LumenSendMemoType = "text" | "id" | "hash";

/** Values handed to `onSubmit` once the user confirms the review step. */
export interface LumenSendFormValues {
  /** Resolved destination: a G... account or the M... muxed address entered. */
  destination: string;
  /** Destination exactly as entered (G..., M... or federation name*domain). */
  destinationInput: string;
  amount: string;
  assetCode: string;
  /** Memo value, or undefined when no memo is attached. */
  memo?: string;
  memoType?: LumenSendMemoType;
}

export interface LumenFederationRecord {
  accountId: string;
  memo?: string;
  memoType?: LumenSendMemoType;
}

export interface LumenSendFormProps {
  /** Submits the confirmed payment. Resolve with the transaction hash. */
  onSubmit: (values: LumenSendFormValues) => Promise<{ hash: string }>;
  /** Asset code being sent. Defaults to "XLM". */
  assetCode?: string;
  /** Horizon URL used by the default memo-required check. Defaults to testnet. */
  horizonUrl?: string;
  /** Resolves a federation address (name*domain). Defaults to SEP-0002 lookup. */
  resolveFederation?: (address: string) => Promise<LumenFederationRecord>;
  /** Returns true when the account requires a memo (SEP-0029). */
  isMemoRequired?: (accountId: string) => Promise<boolean>;
  /** Optional className applied to the form element. */
  className?: string;
}

type Step = "edit" | "review" | "done";

interface FieldErrors {
  destination?: string;
  amount?: string;
  memo?: string;
}

const FEDERATION_PATTERN = /^[^*\s]+\*[^*\s]+\.[^*\s]+$/;
const AMOUNT_PATTERN = /^\d+(\.\d{1,7})?$/;
const MEMO_ID_PATTERN = /^\d+$/;
const MEMO_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

export function isFederationAddress(value: string): boolean {
  return FEDERATION_PATTERN.test(value);
}

async function defaultResolveFederation(address: string): Promise<LumenFederationRecord> {
  const record = await Federation.Server.resolve(address);
  const memoType = record.memo_type as LumenSendMemoType | undefined;
  return {
    accountId: record.account_id,
    memo: record.memo,
    memoType: memoType === "text" || memoType === "id" || memoType === "hash" ? memoType : undefined,
  };
}

function createMemoRequiredCheck(horizonUrl: string) {
  return async (accountId: string): Promise<boolean> => {
    const response = await fetch(`${horizonUrl.replace(/\/$/, "")}/accounts/${accountId}`);
    if (response.status === 404) return false;
    if (!response.ok) throw new Error(`Failed to load destination account (${response.status})`);
    const account = (await response.json()) as { data?: Record<string, string> };
    // SEP-0029: data entry "config.memo_required" set to "1" (base64 "MQ==").
    return account.data?.["config.memo_required"] === "MQ==";
  };
}

function validate(destination: string, amount: string, memo: string, memoType: LumenSendMemoType): FieldErrors {
  const errors: FieldErrors = {};
  const dest = destination.trim();
  if (!dest) {
    errors.destination = "Enter a destination address";
  } else if (
    !StrKey.isValidEd25519PublicKey(dest) &&
    !StrKey.isValidMed25519PublicKey(dest) &&
    !isFederationAddress(dest)
  ) {
    errors.destination = "Enter a valid G... or M... address or a federation address (name*domain)";
  }

  const amt = amount.trim();
  if (!amt) {
    errors.amount = "Enter an amount";
  } else if (!AMOUNT_PATTERN.test(amt) || Number(amt) <= 0) {
    errors.amount = "Enter a positive amount with up to 7 decimal places";
  }

  const m = memo.trim();
  if (m) {
    if (memoType === "text" && new TextEncoder().encode(m).length > 28) {
      errors.memo = "Text memos are limited to 28 bytes";
    } else if (memoType === "id" && !MEMO_ID_PATTERN.test(m)) {
      errors.memo = "ID memos must be a whole number";
    } else if (memoType === "hash" && !MEMO_HASH_PATTERN.test(m)) {
      errors.memo = "Hash memos must be 64 hexadecimal characters";
    }
  }
  return errors;
}

/**
 * LumenSendForm
 *
 * Prebuilt send flow: destination (G..., M... or federation address), amount
 * and memo inputs, a review step and submission. Warns when the destination
 * requires a memo (SEP-0029) and none was entered.
 */
export function LumenSendForm({
  onSubmit,
  assetCode = "XLM",
  horizonUrl = "https://horizon-testnet.stellar.org",
  resolveFederation = defaultResolveFederation,
  isMemoRequired,
  className,
}: LumenSendFormProps): React.ReactElement {
  const id = useId();
  const [step, setStep] = useState<Step>("edit");
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [memoType, setMemoType] = useState<LumenSendMemoType>("text");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [memoWarning, setMemoWarning] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);

  const handleReview = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setSubmitError(null);
      setMemoWarning(null);
      const fieldErrors = validate(destination, amount, memo, memoType);
      setErrors(fieldErrors);
      if (Object.keys(fieldErrors).length > 0) return;

      setBusy(true);
      try {
        const input = destination.trim();
        let target = input;
        let currentMemo = memo.trim();
        if (isFederationAddress(input)) {
          const record = await resolveFederation(input);
          target = record.accountId;
          if (record.memo && !currentMemo) {
            currentMemo = record.memo;
            setMemo(record.memo);
            setMemoType(record.memoType ?? "text");
          }
        }

        // Muxed addresses carry their own ID, so the memo check is skipped.
        if (!StrKey.isValidMed25519PublicKey(target) && !currentMemo) {
          const check = isMemoRequired ?? createMemoRequiredCheck(horizonUrl);
          if (await check(target)) {
            setResolved(target);
            setMemoWarning("This destination requires a memo. Add a memo before continuing.");
            return;
          }
        }

        setResolved(target);
        setStep("review");
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [destination, amount, memo, memoType, resolveFederation, isMemoRequired, horizonUrl],
  );

  const handleConfirm = useCallback(async () => {
    setBusy(true);
    setSubmitError(null);
    const trimmedMemo = memo.trim();
    try {
      const result = await onSubmit({
        destination: resolved,
        destinationInput: destination.trim(),
        amount: amount.trim(),
        assetCode,
        memo: trimmedMemo || undefined,
        memoType: trimmedMemo ? memoType : undefined,
      });
      setHash(result.hash);
      setStep("done");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [onSubmit, resolved, destination, amount, assetCode, memo, memoType]);

  const reset = useCallback(() => {
    setStep("edit");
    setDestination("");
    setAmount("");
    setMemo("");
    setMemoType("text");
    setResolved("");
    setHash(null);
    setSubmitError(null);
    setMemoWarning(null);
  }, []);

  const destinationId = `${id}-destination`;
  const amountId = `${id}-amount`;
  const memoId = `${id}-memo`;
  const memoTypeId = `${id}-memo-type`;
  const classes = ["lumen-send-form", className].filter(Boolean).join(" ");

  if (step === "done") {
    return (
      <div className={classes} role="status" aria-live="polite" data-testid="lumen-send-form-success">
        <p>Payment sent.</p>
        <p>
          Transaction hash: <code>{hash}</code>
        </p>
        <button type="button" onClick={reset}>
          Send another payment
        </button>
      </div>
    );
  }

  if (step === "review") {
    const trimmedMemo = memo.trim();
    return (
      <section className={classes} aria-label="Review payment" data-testid="lumen-send-form-review">
        <h2>Review payment</h2>
        <dl>
          <dt>Destination</dt>
          <dd>
            <code>{destination.trim()}</code>
            {resolved !== destination.trim() && (
              <>
                {" "}
                (<code>{resolved}</code>)
              </>
            )}
          </dd>
          <dt>Amount</dt>
          <dd>
            {amount.trim()} {assetCode}
          </dd>
          <dt>Memo</dt>
          <dd>{trimmedMemo ? `${trimmedMemo} (${memoType})` : "None"}</dd>
        </dl>
        {submitError && (
          <div role="alert" className="lumen-send-form__error">
            {submitError}
          </div>
        )}
        <button type="button" onClick={() => setStep("edit")} disabled={busy}>
          Back
        </button>
        <button type="button" onClick={() => void handleConfirm()} disabled={busy} aria-busy={busy}>
          {busy ? "Sending…" : "Confirm and send"}
        </button>
      </section>
    );
  }

  return (
    <form
      className={classes}
      aria-label="Send payment"
      noValidate
      onSubmit={(e) => void handleReview(e)}
      data-testid="lumen-send-form"
    >
      <div className="lumen-send-form__field">
        <label htmlFor={destinationId}>Destination</label>
        <input
          id={destinationId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="G..., M... or name*domain"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          aria-invalid={errors.destination ? true : undefined}
          aria-describedby={errors.destination ? `${destinationId}-error` : undefined}
        />
        {errors.destination && (
          <p id={`${destinationId}-error`} className="lumen-send-form__error">
            {errors.destination}
          </p>
        )}
      </div>

      <div className="lumen-send-form__field">
        <label htmlFor={amountId}>Amount ({assetCode})</label>
        <input
          id={amountId}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={errors.amount ? true : undefined}
          aria-describedby={errors.amount ? `${amountId}-error` : undefined}
        />
        {errors.amount && (
          <p id={`${amountId}-error`} className="lumen-send-form__error">
            {errors.amount}
          </p>
        )}
      </div>

      <div className="lumen-send-form__field">
        <label htmlFor={memoId}>Memo (optional)</label>
        <input
          id={memoId}
          type="text"
          value={memo}
          onChange={(e) => {
            setMemo(e.target.value);
            setMemoWarning(null);
          }}
          aria-invalid={errors.memo ? true : undefined}
          aria-describedby={errors.memo ? `${memoId}-error` : undefined}
        />
        <label htmlFor={memoTypeId}>Memo type</label>
        <select
          id={memoTypeId}
          value={memoType}
          onChange={(e) => setMemoType(e.target.value as LumenSendMemoType)}
        >
          <option value="text">Text</option>
          <option value="id">ID</option>
          <option value="hash">Hash</option>
        </select>
        {errors.memo && (
          <p id={`${memoId}-error`} className="lumen-send-form__error">
            {errors.memo}
          </p>
        )}
      </div>

      {memoWarning && (
        <div role="alert" className="lumen-send-form__warning">
          {memoWarning}
        </div>
      )}
      {submitError && (
        <div role="alert" className="lumen-send-form__error">
          {submitError}
        </div>
      )}

      <button type="submit" disabled={busy} aria-busy={busy}>
        {busy ? "Checking…" : "Review payment"}
      </button>
    </form>
  );
}

export default LumenSendForm;
