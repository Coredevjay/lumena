import { describe, it, expect } from "vitest";
import { Keypair, Address, StrKey, xdr } from "@stellar/stellar-sdk";
import { StellarClient } from "@lumen/core";
import { CosignerService } from "../cosigner/service.js";
import { PolicyEngine } from "../policy/engine.js";
import { EnvSigner } from "../signers/EnvSigner.js";

// A simple counter contract with an `increment` function and an admin-only `reset`.
const COUNTER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 1));
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 2));

function invocation(
  contractId: string,
  functionName: string,
  subInvocations: xdr.SorobanAuthorizedInvocation[] = [],
): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: new Address(contractId).toScAddress(),
        functionName,
        args: [],
      }),
    ),
    subInvocations,
  });
}

function buildEntry(
  credentialAddress: string,
  rootInvocation: xdr.SorobanAuthorizedInvocation,
): string {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: new Address(credentialAddress).toScAddress(),
        nonce: new xdr.Int64(1),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation,
  }).toXDR("base64");
}

describe("CosignerService Soroban authorization entries", () => {
  const cosignerKeypair = Keypair.random();
  const signer = new EnvSigner(cosignerKeypair.secret());
  const client = new StellarClient({ network: "local" });
  const wallet = Keypair.random().publicKey();

  function createCosigner(): CosignerService {
    const policyEngine = new PolicyEngine();
    policyEngine.addPolicy({
      id: "policy-1",
      walletId: wallet,
      rules: [
        {
          type: "contract_allowlist",
          allowedContracts: [{ contractId: COUNTER_CONTRACT, methods: ["increment"] }],
        },
      ],
      createdAt: new Date(),
    });
    return new CosignerService({ client, signer, policyEngine });
  }

  it("signs an auth entry for an allowlisted contract function", async () => {
    const cosigner = createCosigner();
    const result = await cosigner.cosignAuthEntry({
      entryXdr: buildEntry(cosignerKeypair.publicKey(), invocation(COUNTER_CONTRACT, "increment")),
      walletAddress: wallet,
      validUntilLedgerSeq: 1000,
    });

    expect(result.approved).toBe(true);
    expect(result.rulesEvaluated).toEqual(["contract_allowlist"]);

    const signed = xdr.SorobanAuthorizationEntry.fromXDR(result.signedEntryXdr, "base64");
    const credentials = signed.credentials().address();
    expect(credentials.signatureExpirationLedger()).toBe(1000);
    expect(credentials.signature().switch()).toBe(xdr.ScValType.scvVec());
  });

  it("rejects an auth entry for a contract that is not allowlisted", async () => {
    const cosigner = createCosigner();
    const result = await cosigner.cosignAuthEntry({
      entryXdr: buildEntry(cosignerKeypair.publicKey(), invocation(OTHER_CONTRACT, "increment")),
      walletAddress: wallet,
      validUntilLedgerSeq: 1000,
    });

    expect(result.approved).toBe(false);
    expect(result.signedEntryXdr).toBe("");
    expect(result.reason).toContain("not in the allowlist");
  });

  it("rejects an auth entry for a method that is not allowed", async () => {
    const cosigner = createCosigner();
    const result = await cosigner.cosignAuthEntry({
      entryXdr: buildEntry(cosignerKeypair.publicKey(), invocation(COUNTER_CONTRACT, "reset")),
      walletAddress: wallet,
      validUntilLedgerSeq: 1000,
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Method reset is not allowed");
  });

  it("applies the allowlist to sub-invocations", async () => {
    const cosigner = createCosigner();
    const result = await cosigner.cosignAuthEntry({
      entryXdr: buildEntry(
        cosignerKeypair.publicKey(),
        invocation(COUNTER_CONTRACT, "increment", [invocation(OTHER_CONTRACT, "transfer")]),
      ),
      walletAddress: wallet,
      validUntilLedgerSeq: 1000,
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toContain(OTHER_CONTRACT);
  });

  it("rejects an auth entry whose credentials belong to another address", async () => {
    const cosigner = createCosigner();
    const result = await cosigner.cosignAuthEntry({
      entryXdr: buildEntry(Keypair.random().publicKey(), invocation(COUNTER_CONTRACT, "increment")),
      walletAddress: wallet,
      validUntilLedgerSeq: 1000,
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("do not match");
  });

  it("rejects invalid auth entry XDR", async () => {
    const cosigner = createCosigner();
    const result = await cosigner.cosignAuthEntry({
      entryXdr: "not-xdr",
      walletAddress: wallet,
      validUntilLedgerSeq: 1000,
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Invalid authorization entry XDR");
  });
});
