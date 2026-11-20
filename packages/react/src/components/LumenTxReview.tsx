import React from "react";
import { TransactionBuilder, Operation, xdr } from "@stellar/stellar-sdk";

export interface LumenTxReviewProps {
  xdr: string;
  networkPassphrase: string;
}

function summarizeOperation(op: Operation): string {
  switch (op.type) {
    case "payment":
      return `Payment ${(op as Operation.Payment).amount} to ${(op as Operation.Payment).destination}`;
    case "pathPaymentStrictSend":
    case "pathPaymentStrictReceive":
      return `Path payment via ${op.type}`;
    case "changeTrust":
      return `Change trust for ${(op as Operation.ChangeTrust).line.getCode?.() ?? "asset"}`;
    case "invokeHostFunction":
      return "Invoke host function (Soroban)";
    default:
      return String(op.type);
  }
}

export function LumenTxReview({ xdr, networkPassphrase }: LumenTxReviewProps): React.ReactElement {
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  const ops = (tx as { operations?: Operation[] }).operations ?? [];

  return (
    <div className="lumen-tx-review" data-testid="lumen-tx-review">
      <p>Fee: {String((tx as { fee?: string }).fee ?? "—")}</p>
      <ul>
        {ops.map((op, index) => (
          <li key={index}>{summarizeOperation(op)}</li>
        ))}
      </ul>
      {ops.length > 3 && (
        <p role="alert" className="lumen-tx-review__warning">
          Unusual transaction: more than three operations.
        </p>
      )}
    </div>
  );
}