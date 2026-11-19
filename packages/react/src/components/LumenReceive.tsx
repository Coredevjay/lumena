import React, { useCallback, useId, useMemo, useState } from "react";
import { encodeQr } from "./qr-code.js";

export interface LumenReceiveProps {
  /** Stellar address (G...) that receives the funds. */
  address: string;
  /** Initial requested amount. */
  defaultAmount?: string;
  /** Initial text memo. */
  defaultMemo?: string;
  /** Show the optional amount input. Defaults to true. */
  showAmount?: boolean;
  /** Show the optional memo input. Defaults to true. */
  showMemo?: boolean;
  /** Asset code for non-native payments. Omit for XLM. */
  assetCode?: string;
  /** Asset issuer for non-native payments. */
  assetIssuer?: string;
  /** Network passphrase to embed in the SEP-0007 URI. */
  networkPassphrase?: string;
  /** Rendered QR size in pixels. Defaults to 200. */
  qrSize?: number;
  /** Called after the address is copied to the clipboard. */
  onCopy?: (address: string) => void;
  /** Optional className applied to the wrapper element. */
  className?: string;
}

export interface Sep7PayParams {
  destination: string;
  amount?: string;
  memo?: string;
  assetCode?: string;
  assetIssuer?: string;
  networkPassphrase?: string;
}

/**
 * Builds a SEP-0007 `web+stellar:pay` URI. Empty optional values are omitted;
 * a memo is encoded as `MEMO_TEXT`.
 */
export function buildSep7PayUri({
  destination,
  amount,
  memo,
  assetCode,
  assetIssuer,
  networkPassphrase,
}: Sep7PayParams): string {
  const params = new URLSearchParams({ destination });
  if (amount?.trim()) params.set("amount", amount.trim());
  if (assetCode?.trim()) {
    params.set("asset_code", assetCode.trim());
    if (assetIssuer?.trim()) params.set("asset_issuer", assetIssuer.trim());
  }
  if (memo?.trim()) {
    params.set("memo", memo.trim());
    params.set("memo_type", "MEMO_TEXT");
  }
  if (networkPassphrase) params.set("network_passphrase", networkPassphrase);
  return `web+stellar:pay?${params.toString().replace(/\+/g, "%20")}`;
}

const QUIET_ZONE = 4;

/**
 * LumenReceive
 *
 * Receive card that shows the wallet address, a SEP-0007 payment QR code, a
 * copy button and optional amount / memo fields that update the QR code.
 */
export function LumenReceive({
  address,
  defaultAmount = "",
  defaultMemo = "",
  showAmount = true,
  showMemo = true,
  assetCode,
  assetIssuer,
  networkPassphrase,
  qrSize = 200,
  onCopy,
  className,
}: LumenReceiveProps): React.ReactElement {
  const id = useId();
  const [amount, setAmount] = useState(defaultAmount);
  const [memo, setMemo] = useState(defaultMemo);
  const [copied, setCopied] = useState(false);

  const uri = useMemo(
    () =>
      buildSep7PayUri({
        destination: address,
        amount: showAmount ? amount : undefined,
        memo: showMemo ? memo : undefined,
        assetCode,
        assetIssuer,
        networkPassphrase,
      }),
    [address, amount, memo, showAmount, showMemo, assetCode, assetIssuer, networkPassphrase],
  );

  const qr = useMemo(() => {
    const matrix = encodeQr(uri);
    let path = "";
    matrix.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) path += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
      });
    });
    return { path, dimension: matrix.length + QUIET_ZONE * 2 };
  }, [uri]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      onCopy?.(address);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available in this context — silently ignore.
    }
  }, [address, onCopy]);

  const amountId = `${id}-amount`;
  const memoId = `${id}-memo`;

  return (
    <section
      className={["lumen-receive", className].filter(Boolean).join(" ")}
      aria-label="Receive payment"
      data-testid="lumen-receive"
    >
      <svg
        className="lumen-receive__qr"
        role="img"
        aria-label={`Payment QR code for ${address}`}
        width={qrSize}
        height={qrSize}
        viewBox={`0 0 ${qr.dimension} ${qr.dimension}`}
        shapeRendering="crispEdges"
        data-testid="lumen-receive-qr"
        data-uri={uri}
      >
        <rect width={qr.dimension} height={qr.dimension} fill="#ffffff" />
        <path d={qr.path} fill="#000000" />
      </svg>

      <div className="lumen-receive__address-row">
        <code className="lumen-receive__address" aria-label={`Wallet address: ${address}`}>
          {address}
        </code>
        <button
          type="button"
          className="lumen-receive__copy-btn"
          aria-label={copied ? "Address copied" : "Copy wallet address"}
          onClick={() => {
            void handleCopy();
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <span role="status" aria-live="polite" className="lumen-receive__copy-status">
          {copied ? "Address copied" : ""}
        </span>
      </div>

      {showAmount && (
        <div className="lumen-receive__field">
          <label htmlFor={amountId}>Amount (optional)</label>
          <input
            id={amountId}
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      )}

      {showMemo && (
        <div className="lumen-receive__field">
          <label htmlFor={memoId}>Memo (optional)</label>
          <input
            id={memoId}
            type="text"
            maxLength={28}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
        </div>
      )}
    </section>
  );
}

export default LumenReceive;
