import type { Keypair, Asset } from "@stellar/stellar-sdk";
import { Operation, TransactionBuilder, BASE_FEE, Memo } from "@stellar/stellar-sdk";
import type { StellarClient } from "../stellar/client.js";
import { KeyManager } from "../keys/manager.js";
import { ContractClient } from "../soroban/client.js";
import { parseResultCodes, StellarResultError } from "../stellar/result-codes.js";
import type { ContractSimulationResult, OperationSpec, ScValInput } from "@lumen/types";
import { LumenError, PolicyDeniedError, SignerError } from "../errors.js";
import { createWalletAccount } from "./create.js";
import { sendPayment, buildPaymentTransaction } from "./send.js";
import { changeTrustline } from "./trust.js";
import {
  getInheritanceStatus,
  requestProxyUpgrade,
  sendInheritanceHeartbeat,
  claimInheritance,
} from "./recovery.js";

export interface WalletOpts {
  client: StellarClient;
  /**
   * The sponsor keypair used to pay account creation reserves and transaction
   * fees. Required when the wallet itself calls `createSponsoredAccount` and
   * `setupMultisig` directly (e.g. server-side usage).
   *
   * In browser environments this MUST be omitted — account creation and fee
   * sponsorship are handled exclusively by calling the backend REST endpoints
   * (`POST /wallet/create`, `POST /fee-bump/submit`). Passing this field from
   * browser code is a severe security vulnerability and is now deprecated.
   *
   * @deprecated Pass `serverUrl` instead and let the server handle sponsorship.
   */
  sponsorKeypair?: Keypair;
  serverPublicKey: string;
  serverUrl?: string;
  ownerKeypair?: Keypair;
  /**
   * Optional KeyManager instance to inject. If not provided, a new default
   * KeyManager is created internally. Inject a custom instance to use another
   * persistent storage backend or to facilitate unit testing.
   */
  keyManager?: KeyManager;
}

export interface WalletRegistry {
  register(address: string): Promise<void> | void;
  list(): Promise<string[]> | string[];
}

/** Result of validating a cross-contract invocation against the policy-guard registry. */
export interface CrossContractValidationResult {
  /** Whether every call target is registered and verified in the policy-guard. */
  allowed: boolean;
  /** The call targets that were rejected (empty when `allowed` is true). */
  rejectedTargets: string[];
}

/** Options for `Wallet.send`. */
export interface SendOpts {
  /**
   * Skip the SEP-0029 memo-required check. Only set this when you are certain
   * the destination does not need a memo.
   */
  skipMemoRequiredCheck?: boolean;
}

/** Result of a USD spend-limit check performed via the oracle consumer contract. */
export interface UsdSpendLimitResult {
  /** Whether the spend is within the configured USD limit. */
  allowed: boolean;
  /** USD value of the spend, expressed in the oracle's base units as a string. */
  usdValue: string;
  /** The configured USD limit, expressed in the oracle's base units as a string. */
  limit: string;
}

/** Options for requesting a proxy upgrade (issue #224). */
export interface ProxyUpgradeRequest {
  /** Address of the proxy contract to upgrade. */
  proxyContractId: string;
  /** Hex-encoded hash of the new contract WASM. */
  newWasmHash: string;
  /** Optional fee override for the invocation transaction. */
  fee?: string;
}

/** Result of an inheritance heartbeat or claim (issue #225). */
export interface InheritanceStatus {
  /** The last recorded heartbeat timestamp (unix seconds). */
  lastHeartbeat: number;
  /** The configured dormancy period in seconds. */
  dormancyPeriod: number;
}

export class InMemoryWalletRegistry implements WalletRegistry {
  private addresses: string[] = [];

  register(address: string): void {
    if (!this.addresses.includes(address)) {
      this.addresses.push(address);
    }
  }

  list(): string[] {
    return [...this.addresses];
  }
}

export class Wallet {
  private client: StellarClient;
  private sponsorKeypair: Keypair | null;
  private serverPublicKey: string;
  private serverUrl?: string;
  private keyManager: KeyManager;
  private _address: string | null = null;
  private _keypair: Keypair | null = null;
  private initialOwnerKeypair?: Keypair;
  private analytics: {
    totalTransactions: number;
    totalXlmVolume: bigint;
    policyViolations: number;
    lastTransactionAt: string | null;
  } = {
    totalTransactions: 0,
    totalXlmVolume: 0n,
    policyViolations: 0,
    lastTransactionAt: null,
  };

  constructor(opts: WalletOpts) {
    this.client = opts.client;
    this.sponsorKeypair = opts.sponsorKeypair ?? null;
    this.serverPublicKey = opts.serverPublicKey;
    this.serverUrl = opts.serverUrl?.replace(/\/+$/, "");
    this.initialOwnerKeypair = opts.ownerKeypair;
    this.keyManager = opts.keyManager ?? new KeyManager();
    if (opts.ownerKeypair) {
      this._keypair = opts.ownerKeypair;
    }
  }

  /** Returns the on-chain account address after the wallet has been created. */
  get address(): string {
    if (!this._address) {
      throw new LumenError("WALLET_NOT_CREATED", "Wallet not created yet");
    }
    return this._address;
  }

  /** Creates, sponsors, configures multisig for, and stores the wallet account. */
  async create(): Promise<{ address: string; publicKey: string }> {
    if (!this.sponsorKeypair) {
      throw new SignerError(
        "SPONSOR_KEYPAIR_REQUIRED",
        "Wallet.create() requires a sponsorKeypair. " +
          "In browser environments, use LumenClient.createWallet() which delegates " +
          "account creation to the backend server (POST /wallet/create) without " +
          "exposing the sponsor secret key.",
      );
    }

    if (!this._keypair) {
      this._keypair = this.keyManager.generateKeypair();
    }

    const { address } = await createWalletAccount({
      client: this.client,
      sponsorKeypair: this.sponsorKeypair,
      accountKeypair: this._keypair,
      coSignerPublicKey: this.serverPublicKey,
    });

    this._address = address;
    this.keyManager.store(this._keypair, "default");

    return { address, publicKey: address };
  }

  /** Reads the wallet balance for native XLM or the provided Stellar asset. */
  async getBalance(asset?: Asset): Promise<string> {
    const account = await this.client.horizon.loadAccount(this.address);

    if (!asset || asset.isNative()) {
      const balance = account.balances.find((b: any) => b.asset_type === "native");
      return balance?.balance ?? "0";
    }

    const balance = account.balances.find(
      (b: any) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
    );
    return (balance as any)?.balance ?? "0";
  }

  /** Builds, signs, and submits a payment from the wallet account. */
  async send(
    destination: string,
    asset: Asset,
    amount: string,
    memo?: Memo | string,
    opts: SendOpts = {},
  ): Promise<{ hash: string }> {
    if (!this._keypair) {
      throw new SignerError("WALLET_NOT_INITIALIZED", "Wallet not initialized");
    }
    if (!this.serverUrl) {
      throw new LumenError(
        "SERVER_URL_REQUIRED",
        "A Lumen server URL is required to send payments through policy enforcement",
      );
    }

    const { hash } = await sendPayment({
      client: this.client,
      keypair: this._keypair,
      address: this.address,
      serverUrl: this.serverUrl,
      destination,
      asset,
      amount,
      memo,
      opts,
      toStellarResultError: (details) => this.toStellarResultError(details),
    });

    this.recordTransaction(asset, amount);
    return { hash };
  }

  /**
   * Checks whether the destination account has opted in to SEP-0029 by setting
   * the `config.memo_required` data entry to `1`. Muxed (M...) destinations and
   * accounts that do not exist yet never require a memo.
   */
  async checkMemoRequired(destination: string): Promise<boolean> {
    if (destination.startsWith("M")) return false;

    let account: { data_attr?: Record<string, string> };
    try {
      account = await this.client.horizon.loadAccount(destination);
    } catch (error) {
      if ((error as any)?.response?.status === 404) return false;
      throw error;
    }

    // Horizon returns data entry values base64-encoded; "MQ==" is "1".
    return account.data_attr?.["config.memo_required"] === "MQ==";
  }

  async buildPaymentTransaction(
    destination: string,
    asset: Asset,
    amount: string,
    memo?: Memo | string,
  ): Promise<string> {
    if (!this._keypair) {
      throw new SignerError("WALLET_NOT_INITIALIZED", "Wallet not initialized");
    }

    return buildPaymentTransaction({
      client: this.client,
      keypair: this._keypair,
      address: this.address,
      destination,
      asset,
      amount,
      memo,
    });
  }

  async buildTransaction(operations: OperationSpec[]): Promise<string> {
    if (!this._keypair) {
      throw new SignerError("WALLET_NOT_INITIALIZED", "Wallet not initialized");
    }
    if (operations.length === 0) {
      throw new LumenError("NO_OPERATIONS", "At least one operation is required");
    }

    const account = await this.client.horizon.loadAccount(this.address);

    const builder = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.client.networkPassphrase,
    });

    for (const spec of operations) {
      builder.addOperation(this.toOperation(spec));
    }

    const tx = builder.setTimeout(180).build();
    tx.sign(this._keypair);
    return tx.toXDR();
  }

  private toOperation(spec: OperationSpec): any {
    switch (spec.type) {
      case "payment":
        return Operation.payment({
          destination: spec.destination,
          asset: spec.asset,
          amount: spec.amount,
        });
      case "createAccount":
        return Operation.createAccount({
          destination: spec.destination,
          startingBalance: spec.startingBalance,
        });
      case "changeTrust":
        return Operation.changeTrust({ asset: spec.asset });
      case "manageData":
        return Operation.manageData({
          name: spec.name,
          value: spec.value ?? null,
        });
      default: {
        const exhaustive: never = spec;
        throw new LumenError(
          "UNSUPPORTED_OPERATION",
          `Unsupported operation type: ${(exhaustive as any).type}`,
        );
      }
    }
  }

  /**
   * Establish or modify a trustline for this wallet account.
   * Pass `limit = '0'` to remove the trustline.
   */
  async changeTrust(asset: Asset, limit?: string): Promise<{ hash: string }> {
    if (!this._keypair) {
      throw new SignerError("WALLET_NOT_INITIALIZED", "Wallet not initialized");
    }

    return changeTrustline({
      client: this.client,
      keypair: this._keypair,
      address: this.address,
      asset,
      limit,
    });
  }

  async simulateContract(
    contractId: string,
    method: string,
    args?: ScValInput[],
  ): Promise<ContractSimulationResult> {
    const contractClient = new ContractClient(this.client);
    return contractClient.simulate({ contractId, method, args }, this.address);
  }

  async buildContractInvocationTransaction(
    contractId: string,
    method: string,
    args?: ScValInput[],
    fee?: string,
  ): Promise<string> {
    if (!this._keypair) {
      throw new SignerError("WALLET_NOT_INITIALIZED", "Wallet not initialized");
    }

    const contractClient = new ContractClient(this.client);
    const tx = await contractClient.buildTransaction({
      sourceAddress: this.address,
      invocation: { contractId, method, args },
      fee,
    });

    tx.sign(this._keypair);
    return tx.toXDR();
  }

  async invokeContract(
    contractId: string,
    method: string,
    args?: ScValInput[],
    fee?: string,
  ): Promise<{ hash: string }> {
    if (!this._keypair) {
      throw new SignerError("WALLET_NOT_INITIALIZED", "Wallet not initialized");
    }

    const xdr = await this.buildContractInvocationTransaction(contractId, method, args, fee);
    const parsed = TransactionBuilder.fromXDR(xdr, this.client.networkPassphrase);

    const result = await this.client.horizon.submitTransaction(parsed as any);
    if (result.successful) {
      this.recordTransaction(undefined, undefined);
      return { hash: result.hash };
    }

    throw new LumenError(
      "CONTRACT_INVOCATION_FAILED",
      `Contract invocation failed: ${result.hash}`,
    );
  }

  /**
   * Validates a set of cross-contract call targets against the policy-guard
   * registry (issue #222). Unregistered targets are rejected; registered
   * targets are permitted to execute.
   *
   * @param policyGuardContractId Address of the deployed policy-guard contract.
   * @param callTargets Contract addresses that the batch will invoke.
   */
  async validateCrossContractInvocation(
    policyGuardContractId: string,
    callTargets: string[],
  ): Promise<CrossContractValidationResult> {
    if (callTargets.length === 0) {
      return { allowed: true, rejectedTargets: [] };
    }

    const contractClient = new ContractClient(this.client);
    const rejectedTargets: string[] = [];

    for (const target of callTargets) {
      const simulation = await contractClient.simulate(
        {
          contractId: policyGuardContractId,
          method: "is_registered",
          args: [{ type: "address", value: target }],
        },
        this.address,
      );

      if (!this.isTruthySimulationResult(simulation)) {
        rejectedTargets.push(target);
      }
    }

    return { allowed: rejectedTargets.length === 0, rejectedTargets };
  }

  /**
   * Invokes a contract only after validating every cross-contract call target
   * against the policy-guard registry (issue #222). Throws when any target is
   * unregistered so that execution is never dispatched.
   */
  async invokeContractWithPolicyGuard(
    policyGuardContractId: string,
    contractId: string,
    method: string,
    args?: ScValInput[],
    callTargets: string[] = [],
    fee?: string,
  ): Promise<{ hash: string }> {
    const validation = await this.validateCrossContractInvocation(
      policyGuardContractId,
      callTargets,
    );
    if (!validation.allowed) {
      this.recordPolicyViolation();
      throw new PolicyDeniedError(
        "CROSS_CONTRACT_TARGET_REJECTED",
        `Cross-contract invocation rejected: unregistered targets ${validation.rejectedTargets.join(", ")}`,
      );
    }

    return this.invokeContract(contractId, method, args, fee);
  }

  /**
   * Checks whether a spend is within the configured USD limit using the oracle
   * consumer contract (issue #223). Fails safely when the oracle price is stale
   * or missing by treating the spend as disallowed.
   *
   * @param oracleSpendLimitContractId Address of the oracle-spend-limit contract.
   * @param asset Address (or symbol) of the asset being spent.
   * @param amount Amount of the asset, in its smallest unit, as a string.
   */
  async checkUsdSpendLimit(
    oracleSpendLimitContractId: string,
    asset: string,
    amount: string,
  ): Promise<UsdSpendLimitResult> {
    const contractClient = new ContractClient(this.client);
    const simulation = await contractClient.simulate(
      {
        contractId: oracleSpendLimitContractId,
        method: "check_spend_limit",
        args: [
          { type: "address", value: this.address },
          { type: "address", value: asset },
          { type: "i128", value: amount },
        ],
      },
      this.address,
    );

    const parsed = this.parseUsdSpendLimitResult(simulation);
    if (!parsed) {
      // Fail safely: a stale or missing oracle price must never authorize a spend.
      return { allowed: false, usdValue: "0", limit: "0" };
    }
    return parsed;
  }

  /**
   * Requests an upgrade of a proxy contract (issue #224). The proxy enforces
   * multi-sig approval and a mandatory timelock on-chain; this method only
   * submits the upgrade request.
   */
  async requestProxyUpgrade(request: ProxyUpgradeRequest): Promise<{ hash: string }> {
    return requestProxyUpgrade({
      invoke: (contractId, method, args, fee) =>
        this.invokeContract(contractId, method, args, fee),
      request,
    });
  }

  /**
   * Sends an inheritance heartbeat to the vault contract (issue #225),
   * resetting the dormancy timer.
   */
  async sendInheritanceHeartbeat(inheritanceContractId: string): Promise<{ hash: string }> {
    return sendInheritanceHeartbeat({
      invoke: (contractId, method, args, fee) =>
        this.invokeContract(contractId, method, args, fee),
      inheritanceContractId,
    });
  }

  /**
   * Claims custody of an inheritance vault as the designated beneficiary
   * (issue #225). The contract rejects the claim while the heartbeat is active.
   */
  async claimInheritance(inheritanceContractId: string): Promise<{ hash: string }> {
    return claimInheritance({
      invoke: (contractId, method, args, fee) =>
        this.invokeContract(contractId, method, args, fee),
      inheritanceContractId,
    });
  }

  /** Reads the current inheritance vault status (issue #225). */
  async getInheritanceStatus(inheritanceContractId: string): Promise<InheritanceStatus> {
    return getInheritanceStatus({
      client: this.client,
      address: this.address,
      inheritanceContractId,
    });
  }

  /**
   * Converts a fee-bump error response body into a typed `StellarResultError`
   * when it carries a result code, either as the server error envelope
   * (`{ error, code, operationIndex, hint }`) or as raw Horizon result codes.
   */
  private toStellarResultError(details: string): StellarResultError | null {
    let body: unknown;
    try {
      body = JSON.parse(details);
    } catch {
      return null;
    }
    if (typeof body !== "object" || body === null) return null;

    const envelope = body as Record<string, unknown>;
    if (typeof envelope.code === "string" && typeof envelope.hint === "string") {
      return new StellarResultError({
        code: envelope.code,
        operationIndex:
          typeof envelope.operationIndex === "number" ? envelope.operationIndex : null,
        message: typeof envelope.error === "string" ? envelope.error : envelope.code,
        hint: envelope.hint,
      });
    }

    const parsed = parseResultCodes(body);
    return parsed ? new StellarResultError(parsed) : null;
  }

  private isTruthySimulationResult(simulation: ContractSimulationResult): boolean {
    const result: unknown = (simulation as any)?.result;
    if (typeof result === "boolean") return result;
    if (typeof result === "string") return result === "true" || result === "1";
    if (typeof result === "object" && result !== null && "value" in result) {
      const value = (result as any).value;
      if (typeof value === "boolean") return value;
      if (typeof value === "string") return value === "true" || value === "1";
    }
    return false;
  }

  private parseUsdSpendLimitResult(
    simulation: ContractSimulationResult,
  ): UsdSpendLimitResult | null {
    const result: unknown = (simulation as any)?.result;
    if (typeof result !== "object" || result === null) return null;

    const allowed = (result as any).allowed;
    const usdValue = (result as any).usd_value ?? (result as any).usdValue;
    const limit = (result as any).limit;

    if (typeof allowed !== "boolean") return null;
    if (usdValue === undefined || limit === undefined) return null;

    return {
      allowed,
      usdValue: String(usdValue),
      limit: String(limit),
    };
  }

  private recordTransaction(asset: Asset | undefined, amount: string | undefined): void {
    this.analytics.totalTransactions += 1;
    this.analytics.lastTransactionAt = new Date().toISOString();

    if (asset && asset.isNative() && amount) {
      const stroops = this.toStroops(amount);
      if (stroops !== null) {
        this.analytics.totalXlmVolume += stroops;
      }
    }
  }

  private toStroops(amount: string): bigint | null {
    const match = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
    if (!match) return null;
    const whole = BigInt(match[1]);
    const fraction = (match[2] ?? "").padEnd(7, "0").slice(0, 7);
    return whole * 10_000_000n + BigInt(fraction);
  }

  private fromStroops(stroops: bigint): string {
    const whole = stroops / 10_000_000n;
    const fraction = (stroops % 10_000_000n).toString().padStart(7, "0").replace(/0+$/, "");
    return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
  }

  recordPolicyViolation(): void {
    this.analytics.policyViolations += 1;
  }

  getAnalytics(): WalletAnalytics {
    return {
      address: this.address,
      totalTransactions: this.analytics.totalTransactions,
      totalXlmVolume: this.fromStroops(this.analytics.totalXlmVolume),
      policyViolations: this.analytics.policyViolations,
      lastTransactionAt: this.analytics.lastTransactionAt,
    };
  }

  getAddress(): string {
    return this.address;
  }
}
