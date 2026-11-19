import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import {
  Address,
  BASE_FEE,
  Keypair,
  Operation,
  Transaction,
  TransactionBuilder,
  hash,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import type { ScValInput } from "@lumen/types";
import { StellarClient } from "../stellar/client.js";
import { ContractClient } from "../soroban/client.js";
import { sc } from "../soroban/scval.js";

// Contract-to-TypeScript integration tests (#575). These run in CI against a
// `stellar/quickstart` container with the contracts built to CONTRACT_WASM_DIR,
// and are skipped when either is unavailable.
const HORIZON_URL = process.env.HORIZON_URL ?? "http://localhost:8000";
const RPC_URL = process.env.RPC_URL ?? "http://localhost:8000/rpc";
const WASM_DIR = process.env.CONTRACT_WASM_DIR;

async function isLocalNetworkAvailable(): Promise<boolean> {
  try {
    const res = await fetch(HORIZON_URL, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}
const localAvailable = await isLocalNetworkAvailable();
const describeContracts = localAvailable && WASM_DIR ? describe : describe.skip;

const client = new StellarClient({ network: "local", horizonUrl: HORIZON_URL, rpcUrl: RPC_URL });
const contracts = new ContractClient(client);
const deployer = Keypair.random();

/** Passes a pre-built ScVal (vec/map) through `toScVal`, which returns ScVals unchanged. */
function raw(value: xdr.ScVal): ScValInput {
  return value as unknown as ScValInput;
}

/** Builds an invocation argument with the typed `sc` builders. */
function arg(value: xdr.ScVal): ScValInput {
  return raw(value);
}

async function fundAccount(pubkey: string): Promise<void> {
  await fetch(`${HORIZON_URL}/friendbot?addr=${pubkey}`).catch(() => undefined);
  for (let i = 0; i < 30; i++) {
    try {
      await client.horizon.loadAccount(pubkey);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Account ${pubkey} was not funded`);
}

async function signAndSend(tx: Transaction): Promise<xdr.ScVal | undefined> {
  tx.sign(deployer);
  const sent = await client.rpc.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(`sendTransaction failed: ${sent.errorResult?.toXDR("base64")}`);
  }
  for (let i = 0; i < 60; i++) {
    const res = await client.rpc.getTransaction(sent.hash);
    if (res.status === rpc.Api.GetTransactionStatus.SUCCESS) return res.returnValue;
    if (res.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error(`Transaction ${sent.hash} failed`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Transaction ${sent.hash} was not confirmed`);
}

async function submitOperation(op: xdr.Operation): Promise<xdr.ScVal | undefined> {
  const account = await client.horizon.loadAccount(deployer.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: client.networkPassphrase,
  })
    .addOperation(op)
    .setTimeout(180)
    .build();
  return signAndSend((await client.rpc.prepareTransaction(tx)) as Transaction);
}

async function deploy(name: string): Promise<string> {
  const wasm = readFileSync(join(WASM_DIR!, `${name}.wasm`));
  await submitOperation(Operation.uploadContractWasm({ wasm }));
  const created = await submitOperation(
    Operation.createCustomContract({
      address: new Address(deployer.publicKey()),
      wasmHash: hash(wasm),
      salt: randomBytes(32),
    }),
  );
  if (!created) throw new Error(`Deploying ${name} returned no contract address`);
  return Address.fromScVal(created).toString();
}

async function invoke(contractId: string, method: string, args: ScValInput[]): Promise<void> {
  const tx = await contracts.buildTransaction({
    sourceAddress: deployer.publicKey(),
    invocation: { contractId, method, args },
  });
  await signAndSend(tx);
}

describeContracts("Soroban helpers against deployed contracts", () => {
  let paymasterId: string;
  let sessionKeysId: string;
  let smartAccountId: string;

  beforeAll(async () => {
    await fundAccount(deployer.publicKey());
    paymasterId = await deploy("paymaster");
    sessionKeysId = await deploy("session_keys");
    smartAccountId = await deploy("smart_account");
  }, 300_000);

  it("initializes the paymaster and reads its state back", async () => {
    await invoke(paymasterId, "initialize", [
      { value: deployer.publicKey(), type: "address" },
      { value: 100, type: "u32" },
    ]);

    const owner = await contracts.simulate({ contractId: paymasterId, method: "owner" });
    expect(owner.successful).toBe(true);
    expect(owner.returnValue).toBe(deployer.publicKey());

    const epoch = await contracts.simulate({ contractId: paymasterId, method: "epoch_length" });
    expect(epoch.successful).toBe(true);
    expect(epoch.returnValue).toBe(100);
  }, 120_000);

  it("registers a session key and validates calls against it", async () => {
    const sessionKey = Keypair.random().publicKey();
    await invoke(sessionKeysId, "register_session_key", [
      arg(sc.address(deployer.publicKey())),
      arg(sc.address(sessionKey)),
      arg(sc.u64(BigInt(Math.floor(Date.now() / 1000) + 3600))),
      arg(sc.vec([sc.address(paymasterId)])),
      arg(sc.vec([sc.symbol("deposit")])),
      arg(sc.i128(1000n)),
    ]);

    const allowed = await contracts.simulate({
      contractId: sessionKeysId,
      method: "validate_session_call",
      args: [
        arg(sc.address(sessionKey)),
        arg(sc.address(paymasterId)),
        arg(sc.symbol("deposit")),
        arg(sc.i128(10n)),
      ],
    });
    expect(allowed.successful).toBe(true);
    expect(allowed.returnValue).toBe(true);

    const denied = await contracts.simulate({
      contractId: sessionKeysId,
      method: "validate_session_call",
      args: [
        arg(sc.address(sessionKey)),
        arg(sc.address(paymasterId)),
        arg(sc.symbol("withdraw")),
        arg(sc.i128(10n)),
      ],
    });
    expect(denied.successful).toBe(true);
    expect(denied.returnValue).toBe(false);
  }, 120_000);

  it("initializes the smart account signer set", async () => {
    await invoke(smartAccountId, "init", [
      arg(sc.map([[sc.address(deployer.publicKey()), sc.u32(1)]])),
      arg(sc.u32(1)),
    ]);

    const threshold = await contracts.simulate({ contractId: smartAccountId, method: "threshold" });
    expect(threshold.successful).toBe(true);
    expect(threshold.returnValue).toBe(1);
  }, 120_000);
});
