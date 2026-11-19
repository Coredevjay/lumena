import { TransactionBuilder, Transaction, Keypair, xdr } from "@stellar/stellar-sdk";
import type { Signer } from "@lumen/types";
import type { StellarClient } from "@lumen/core";
import type { WebhookDispatcher } from "../webhook/dispatcher.js";
import { trackOperation } from "../lifecycle.js";
import type { SequenceAllocator, SequenceReservation } from "./sequence-allocator.js";

/** Default maximum fee (in stroops) the sponsor will ever pay for a fee-bump. */
export const DEFAULT_MAX_FEE_STROOPS = 10_000_000;

/** Thrown when a fee-bump would exceed the configured maximum fee cap. */
export class FeeCapExceededError extends Error {
  readonly fee: number;
  readonly maxFeeStroops: number;

  constructor(fee: number, maxFeeStroops: number) {
    super(
      `Fee-bump fee ${fee} stroops exceeds maximum allowed ${maxFeeStroops} stroops`,
    );
    this.name = "FeeCapExceededError";
    this.fee = fee;
    this.maxFeeStroops = maxFeeStroops;
  }
}

/**
 * Resolve the maximum fee cap from an explicit option or the
 * `MAX_FEE_STROOPS` env var, falling back to {@link DEFAULT_MAX_FEE_STROOPS}.
 */
function resolveMaxFeeStroops(explicit?: number): number {
  if (explicit !== undefined) return explicit;
  const fromEnv = process.env.MAX_FEE_STROOPS;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_MAX_FEE_STROOPS;
}

export interface FeeSponsorOpts {
  client: StellarClient;
  /**
   * Production: use an AwsKmsSigner. Dev/testnet: use an EnvSigner.
   *
   * Single-signer mode. Ignored when `sponsors` is provided. Kept for
   * backwards compatibility and treated as a one-entry registry with
   * weight 1.
   */
  signer?: Signer;
  /**
   * Multi-sponsor rotation registry. When provided, fee-bumps are assigned to
   * one of these accounts via weighted random selection (see
   * `selectSponsor`). Accounts flagged `draining` are never selected.
   */
  sponsors?: SponsorAccount[];
  baseFee?: string;
  /**
   * Maximum fee (in stroops) the sponsor will pay for a single fee-bump.
   * Defaults to `MAX_FEE_STROOPS` env var, then {@link DEFAULT_MAX_FEE_STROOPS}.
   */
  maxFeeStroops?: number;
  webhookDispatcher?: WebhookDispatcher;
  /**
   * Optional distributed sequence allocator. When provided, each fee-bump
   * transaction reserves a distinct sequence number so concurrent submissions
   * do not collide on the sponsor account sequence.
   */
  sequenceAllocator?: SequenceAllocator;
  /** Max attempts for the exponential-backoff retry on txBAD_SEQ. Default 5. */
  maxSubmitAttempts?: number;
  /** Base delay (ms) for exponential backoff. Default 100. */
  retryBaseDelayMs?: number;
  /** Called whenever a tx_bad_seq triggers an automatic resequence. */
  onResequence?: () => void;
}

export class FeeSponsorService {
  private client: StellarClient;
  private sponsors: SponsorAccount[];
  private baseFee: string;
  private maxFeeStroops: number;
  private webhookDispatcher?: WebhookDispatcher;
  private sequenceAllocator?: SequenceAllocator;
  private maxSubmitAttempts: number;
  private retryBaseDelayMs: number;
  private overCapCount = 0;

  constructor(opts: FeeSponsorOpts) {
    this.client = opts.client;

    // Build the sponsor registry. Multi-sponsor config takes precedence; the
    // legacy single `signer` is wrapped as a one-entry registry so existing
    // callers keep working unchanged.
    if (opts.sponsors && opts.sponsors.length > 0) {
      this.sponsors = opts.sponsors.map((s) => ({
        signer: s.signer,
        weight: s.weight,
        draining: s.draining ?? false,
      }));
    } else if (opts.signer) {
      this.sponsors = [{ signer: opts.signer, weight: 1, draining: false }];
    } else {
      throw new Error("FeeSponsorService requires either `signer` or `sponsors`");
    }

    for (const s of this.sponsors) {
      if (!(s.weight > 0)) {
        throw new Error(
          `Sponsor ${s.signer.publicKey()} has invalid weight ${s.weight}; weight must be > 0`,
        );
      }
    }

    this.baseFee = opts.baseFee ?? "1000000";
    this.maxFeeStroops = resolveMaxFeeStroops(opts.maxFeeStroops);
    this.webhookDispatcher = opts.webhookDispatcher;
    this.sequenceAllocator = opts.sequenceAllocator;
    this.maxSubmitAttempts = opts.maxSubmitAttempts ?? 5;
    this.retryBaseDelayMs = opts.retryBaseDelayMs ?? 100;
    this.onResequence = opts.onResequence;
  }

  /** Number of automatic resequence events observed by this service. */
  get resequenceEvents(): number {
    return this.resequenceCount;
  }

  /** Current maximum fee cap (stroops). */
  get maxFee(): number {
    return this.maxFeeStroops;
  }

  /** Number of fee-bumps rejected for exceeding the cap (surge guard metric). */
  get feeCapExceededCount(): number {
    return this.overCapCount;
  }

  /**
   * Enforce the fee cap on a built fee-bump transaction. Increments the
   * over-cap metric and throws {@link FeeCapExceededError} when exceeded.
   */
  private enforceFeeCap(fee: number): void {
    if (!Number.isFinite(fee) || fee > this.maxFeeStroops) {
      this.overCapCount += 1;
      throw new FeeCapExceededError(fee, this.maxFeeStroops);
    }
  }

  /**
   * Public key of the first (or only) sponsor account. Retained for callers
   * that assume a single fee payer; prefer `sponsorPublicKeys` in multi-sponsor
   * deployments.
   */
  get publicKey(): string {
    return this.sponsors[0].signer.publicKey();
  }

  /** Public keys of every sponsor account in the registry. */
  get sponsorPublicKeys(): string[] {
    return this.sponsors.map((s) => s.signer.publicKey());
  }

  /**
   * Mark an account as draining so it stops receiving new fee-bumps. Used
   * during rotation: flag the old account, let in-flight transactions settle,
   * then remove it from config. Returns true if the account was found.
   */
  markDraining(publicKey: string): boolean {
    const account = this.sponsors.find((s) => s.signer.publicKey() === publicKey);
    if (!account) return false;
    account.draining = true;
    return true;
  }

  /** True when the given account is present and flagged as draining. */
  isDraining(publicKey: string): boolean {
    const account = this.sponsors.find((s) => s.signer.publicKey() === publicKey);
    return account?.draining ?? false;
  }

  /**
   * Weighted random selection over non-draining sponsor accounts.
   *
   * Algorithm: filter out accounts in drain mode, sum the remaining weights,
   * draw a uniform value in [0, totalWeight), then walk the candidates
   * subtracting each weight until the running total exceeds the draw. Each
   * account is therefore chosen with probability `weight / totalWeight`.
   *
   * Drain semantics: draining accounts are excluded from the candidate set,
   * so their weight is redistributed proportionally among the remaining
   * accounts. If every account is draining we fall back to the full registry
   * (still weighted) so the service keeps operating rather than failing hard;
   * this is logged via the thrown-free path and should be treated as a
   * misconfiguration to alert on.
   */
  selectSponsor(): SponsorAccount {
    const active = this.sponsors.filter((s) => !s.draining);
    const pool = active.length > 0 ? active : this.sponsors;
    const totalWeight = pool.reduce((sum, s) => sum + s.weight, 0);
    let draw = Math.random() * totalWeight;
    for (const account of pool) {
      draw -= account.weight;
      if (draw < 0) return account;
    }
    // Floating-point guard: return the last candidate.
    return pool[pool.length - 1];
  }

  async wrapFeeBump(
    innerTxXdr: string,
    sequence?: string,
    sponsor?: SponsorAccount,
  ): Promise<string> {
    return trackOperation("fee-bump:wrap", async () => {
      const account = sponsor ?? this.selectSponsor();
      const parsed = TransactionBuilder.fromXDR(innerTxXdr, this.client.networkPassphrase);
      const innerTx = parsed instanceof Transaction ? parsed : null;
      if (!innerTx) {
        throw new Error("Expected a regular transaction, not a fee-bump");
      }

      // Build the fee-bump envelope.  buildFeeBumpTransaction derives the
      // fee-source account from a Keypair; we create a public-key-only Keypair
      // so the private key is never needed here.  Signing uses our Signer
      // abstraction so the private key stays in KMS / never in memory.
      const feeSourceKeypair = Keypair.fromPublicKey(account.signer.publicKey());
      const feeBump = TransactionBuilder.buildFeeBumpTransaction(
        feeSourceKeypair,
        this.baseFee,
        innerTx,
        this.client.networkPassphrase,
      );

      // Surge guard: reject before signing/submitting if the bumped fee would
      // exceed the configured cap, protecting the sponsor account.
      this.enforceFeeCap(Number(feeBump.fee));

      // Apply the reserved sequence number (if any) so concurrent fee-bumps
      // from the same sponsor account don't collide.
      if (sequence !== undefined) {
        feeBump.sequence = sequence;
      }

      // Sign via the abstracted Signer.
      const txHash = feeBump.hash();
      const signature = await account.signer.sign(txHash);
      const hint = feeSourceKeypair.rawPublicKey().slice(-4);

      feeBump.signatures.push(
        new xdr.DecoratedSignature({
          hint,
          signature: Buffer.from(signature),
        }),
      );

      return feeBump.toXDR();
    });
  }

  private isBadSeqError(err: unknown): boolean {
    const anyErr = err as { response?: { data?: { extras?: { result_codes?: { transaction?: string } } } }; message?: string };
    const code = anyErr?.response?.data?.extras?.result_codes?.transaction;
    if (code === "txBAD_SEQ" || code === "tx_bad_seq") return true;
    const msg = typeof anyErr?.message === "string" ? anyErr.message : "";
    return msg.includes("txBAD_SEQ") || msg.includes("tx_bad_seq");
  }

  private recordResequence(): void {
    this.resequenceCount += 1;
    try {
      this.onResequence?.();
    } catch {
      // Metrics hooks must never break submission.
    }
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async submit(innerTxXdr: string): Promise<{ hash: string; feeBumpHash: string }> {
    return trackOperation("fee-bump:submit", async () => {
      let lastError: unknown;
      let reservation: SequenceReservation | undefined;
      // tx_bad_seq resequencing is limited to exactly one retry, independent
      // of the general exponential-backoff attempt budget.
      let resequenced = false;

      for (let attempt = 0; attempt < this.maxSubmitAttempts; attempt++) {
        // Reserve a fresh sequence number for each attempt when an allocator
        // is configured. On retry after txBAD_SEQ we re-reserve.
        if (this.sequenceAllocator) {
          reservation = await this.sequenceAllocator.reserve(sponsorKey);
        }

        const feeBumpXdr = await this.wrapFeeBump(innerTxXdr, reservation?.sequence, sponsor);
        const parsed = TransactionBuilder.fromXDR(feeBumpXdr, this.client.networkPassphrase);

        // Re-enforce the cap on every attempt as a defense-in-depth guard.
        this.enforceFeeCap(Number(parsed.fee));

        let result: Awaited<ReturnType<StellarClient["horizon"]["submitTransaction"]>>;
        try {
          result = await this.client.horizon.submitTransaction(parsed);
        } catch (err) {
          if (this.isBadSeqError(err)) {
            // Roll back the reservation so the sequence can be reused.
            if (this.sequenceAllocator && reservation !== undefined) {
              await this.sequenceAllocator
                .rollback(sponsorKey, reservation.sequence)
                .catch(() => {});
            }
            reservation = undefined;

            // Automatic resequencing: refresh from the allocator, rebuild the
            // fee-bump envelope and retry exactly once.
            if (!resequenced) {
              resequenced = true;
              lastError = err;
              this.recordResequence();
              continue;
            }
          }
          throw err;
        }

        if (!result.successful) {
          throw new Error(`Fee-bump submission failed: ${result.hash}`);
        }

        // The sequence number has been consumed by the ledger: retire the
        // reservation so it is never handed out again.
        if (this.sequenceAllocator && reservation !== undefined) {
          await this.sequenceAllocator.commit(reservation.token).catch(() => {});
        }

      if (this.webhookDispatcher) {
        this.webhookDispatcher
          .dispatch("transaction.fee_bump.submitted", {
            feeSource: sponsorKey,
            hash: result.hash,
            feeBumpHash: result.hash,
          })
          .catch(() => {});

        this.webhookDispatcher
          .dispatch("transaction.sponsored", {
            feeSource: sponsorKey,
            hash: result.hash,
          })
          .catch(() => {});
      }

        return { hash: result.hash, feeBumpHash: result.hash };
      }

      throw lastError ?? new Error("Fee-bump submission failed after retries");
    });
  }
}
