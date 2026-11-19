import { describe, expect, it } from "vitest";
import { parseResultCodes, StellarResultError } from "../stellar/result-codes.js";

describe("parseResultCodes", () => {
  it("reports the first failing operation from a Horizon submission error", () => {
    const err = {
      response: {
        data: {
          extras: {
            result_codes: {
              transaction: "tx_failed",
              operations: ["op_success", "op_underfunded"],
            },
          },
        },
      },
    };

    expect(parseResultCodes(err)).toEqual({
      code: "op_underfunded",
      operationIndex: 1,
      message: "The source account does not have enough funds.",
      hint: "Fund the account or reduce the amount.",
    });
  });

  it("maps transaction-level codes with a null operation index", () => {
    const parsed = parseResultCodes({ extras: { result_codes: { transaction: "tx_bad_auth" } } });

    expect(parsed?.code).toBe("tx_bad_auth");
    expect(parsed?.operationIndex).toBeNull();
    expect(parsed?.hint).toContain("signer");
  });

  it("accepts raw result_codes objects", () => {
    expect(parseResultCodes({ transaction: "tx_insufficient_fee" })?.code).toBe(
      "tx_insufficient_fee",
    );
    expect(
      parseResultCodes({ result_codes: { transaction: "tx_failed", operations: ["op_no_trust"] } }),
    ).toMatchObject({ code: "op_no_trust", operationIndex: 0 });
  });

  it("normalizes camel-cased codes", () => {
    expect(parseResultCodes({ transaction: "txBAD_SEQ" })?.code).toBe("tx_bad_seq");
  });

  it("falls back gracefully for unknown codes", () => {
    expect(parseResultCodes({ transaction: "tx_something_new" })).toEqual({
      code: "tx_something_new",
      operationIndex: null,
      message: "Transaction failed with result code tx_something_new.",
      hint: "Check the Stellar result code documentation for details.",
    });
  });

  it("returns null when no result codes are present", () => {
    expect(parseResultCodes(new Error("network down"))).toBeNull();
    expect(parseResultCodes(undefined)).toBeNull();
  });
});

describe("StellarResultError", () => {
  it("exposes the parsed result code fields", () => {
    const err = new StellarResultError(parseResultCodes({ transaction: "tx_too_late" })!);

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("StellarResultError");
    expect(err.code).toBe("tx_too_late");
    expect(err.operationIndex).toBeNull();
    expect(err.message).toBe("The transaction has expired.");
  });
});
