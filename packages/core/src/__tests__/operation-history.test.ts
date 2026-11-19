import { describe, expect, it } from "vitest";
import { describeOperation, type HorizonOperationRecord } from "../stellar/operation-history.js";

const ME = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7";
const OTHER = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H";
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const CONTRACT = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

const fixtures: Record<string, HorizonOperationRecord> = {
  paymentOut: {
    type: "payment",
    source_account: ME,
    from: ME,
    to: OTHER,
    amount: "10.0000000",
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER,
    transaction: { memo: "rent", memo_type: "text" },
  },
  paymentIn: {
    type: "payment",
    source_account: OTHER,
    from: OTHER,
    to: ME,
    amount: "5.0000000",
    asset_type: "native",
  },
  pathPaymentOut: {
    type: "path_payment_strict_send",
    source_account: ME,
    from: ME,
    to: OTHER,
    amount: "9.5000000",
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER,
    source_amount: "50.0000000",
    source_asset_type: "native",
  },
  pathPaymentSwap: {
    type: "path_payment_strict_receive",
    source_account: ME,
    from: ME,
    to: ME,
    amount: "10.0000000",
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER,
    source_amount: "52.0000000",
    source_asset_type: "native",
  },
  trustlineAdd: {
    type: "change_trust",
    source_account: ME,
    trustor: ME,
    trustee: ISSUER,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER,
    limit: "922337203685.4775807",
  },
  trustlineRemove: {
    type: "change_trust",
    source_account: ME,
    trustor: ME,
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: ISSUER,
    limit: "0.0000000",
  },
  claimableCreated: {
    type: "create_claimable_balance",
    source_account: OTHER,
    asset: `USDC:${ISSUER}`,
    amount: "25.0000000",
    claimants: [{ destination: ME, predicate: { unconditional: true } }],
  },
  claimableClaimed: {
    type: "claim_claimable_balance",
    source_account: ME,
    balance_id: "00000000abc",
    claimant: ME,
  },
  contractTransfer: {
    type: "invoke_host_function",
    source_account: ME,
    function: "HostFunctionTypeHostFunctionTypeInvokeContract",
    asset_balance_changes: [
      {
        asset_type: "credit_alphanum4",
        asset_code: "USDC",
        asset_issuer: ISSUER,
        type: "transfer",
        from: ME,
        to: CONTRACT,
        amount: "3.0000000",
      },
    ],
  },
  contractCall: {
    type: "invoke_host_function",
    source_account: ME,
    function: "HostFunctionTypeHostFunctionTypeInvokeContract",
  },
};

describe("stellar/operation-history", () => {
  it("describes an outgoing payment with memo", () => {
    expect(describeOperation(fixtures.paymentOut, { account: ME })).toEqual({
      type: "payment",
      direction: "outgoing",
      amount: "10.0000000",
      assetCode: "USDC",
      counterparty: OTHER,
      memo: "rent",
      summary: "Sent 10.0000000 USDC to GBRP…OX2H",
    });
  });

  it("describes an incoming native payment", () => {
    const d = describeOperation(fixtures.paymentIn, { account: ME });
    expect(d.direction).toBe("incoming");
    expect(d.assetCode).toBe("XLM");
    expect(d.counterparty).toBe(OTHER);
    expect(d.summary).toBe("Received 5.0000000 XLM from GBRP…OX2H");
  });

  it("describes an outgoing path payment with the source amount", () => {
    const d = describeOperation(fixtures.pathPaymentOut, { account: ME });
    expect(d.direction).toBe("outgoing");
    expect(d.amount).toBe("50.0000000");
    expect(d.assetCode).toBe("XLM");
    expect(d.summary).toBe("Sent 9.5000000 USDC to GBRP…OX2H (paid 50.0000000 XLM)");
  });

  it("describes the receiving side of a path payment", () => {
    const d = describeOperation(fixtures.pathPaymentOut, { account: OTHER });
    expect(d.direction).toBe("incoming");
    expect(d.amount).toBe("9.5000000");
    expect(d.assetCode).toBe("USDC");
    expect(d.counterparty).toBe(ME);
  });

  it("describes a path payment to self as a swap", () => {
    const d = describeOperation(fixtures.pathPaymentSwap, { account: ME });
    expect(d.direction).toBe("self");
    expect(d.summary).toBe("Swapped 52.0000000 XLM for 10.0000000 USDC");
  });

  it("describes trustline creation and removal", () => {
    const added = describeOperation(fixtures.trustlineAdd, { account: ME });
    expect(added.summary).toBe("Added trustline for USDC");
    expect(added.counterparty).toBe(ISSUER);
    expect(added.direction).toBe("none");

    const removed = describeOperation(fixtures.trustlineRemove, { account: ME });
    expect(removed.summary).toBe("Removed trustline for USDC");
    expect(removed.amount).toBeNull();
  });

  it("describes a claimable balance from both sides", () => {
    const received = describeOperation(fixtures.claimableCreated, { account: ME });
    expect(received.direction).toBe("incoming");
    expect(received.counterparty).toBe(OTHER);
    expect(received.summary).toBe("Claimable balance of 25.0000000 USDC from GBRP…OX2H");

    const created = describeOperation(fixtures.claimableCreated, { account: OTHER });
    expect(created.direction).toBe("outgoing");
    expect(created.counterparty).toBe(ME);
    expect(created.summary).toBe("Created claimable balance of 25.0000000 USDC for GAAZ…CWN7");
  });

  it("describes claiming a claimable balance", () => {
    const d = describeOperation(fixtures.claimableClaimed, { account: ME });
    expect(d.direction).toBe("incoming");
    expect(d.summary).toBe("Claimed claimable balance");
  });

  it("describes a Soroban invocation with a token transfer", () => {
    const d = describeOperation(fixtures.contractTransfer, { account: ME });
    expect(d.direction).toBe("outgoing");
    expect(d.amount).toBe("3.0000000");
    expect(d.counterparty).toBe(CONTRACT);
    expect(d.summary).toBe("Sent 3.0000000 USDC to CDLZ…CYSC via contract");
  });

  it("describes a Soroban invocation without balance changes", () => {
    const d = describeOperation(fixtures.contractCall, { account: ME });
    expect(d.summary).toBe("Invoked contract");
    expect(d.amount).toBeNull();
  });

  it("falls back to a generic description for other types", () => {
    const d = describeOperation({ type: "set_options", source_account: ME }, { account: ME });
    expect(d.summary).toBe("Set options");
    expect(d.direction).toBe("outgoing");
  });
});
