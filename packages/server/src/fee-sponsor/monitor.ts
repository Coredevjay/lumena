import type { StellarClient } from "@lumen/core";
import { logger } from "../logger.js";
import { sponsorBalanceXlm } from "../metrics.js";
import type { WebhookDispatcher } from "../webhook/dispatcher.js";

export interface SponsorAccountConfig {
  publicKey: string;
  minBalanceXlm?: number;
  /** When true the account is being rotated out: still monitored, but flagged as draining. */
  draining?: boolean;
}

export interface SponsorMonitorOpts {
  client: StellarClient;
  sponsorPublicKey: string;
  minBalanceXlm?: number;
  pollIntervalMs?: number;
  onLowBalance?: (balance: number, threshold: number) => void | Promise<void>;
  webhookUrl?: string;
  webhookDispatcher?: WebhookDispatcher;
  /** Additional sponsor accounts to monitor alongside `sponsorPublicKey`. */
  sponsorAccounts?: SponsorAccountConfig[];
}

export interface CheckBalanceResult {
  balance: number;
  isLow: boolean;
  threshold: number;
  publicKey?: string;
  draining?: boolean;
}

export interface SponsorAccountState {
  publicKey: string;
  minBalanceXlm: number;
  draining: boolean;
  lastBalance?: number;
  lastIsLow?: boolean;
}

export class SponsorMonitorService {
  private client: StellarClient;
  private sponsorPublicKey: string;
  private minBalanceXlm: number;
  private pollIntervalMs: number;
  private onLowBalance?: (balance: number, threshold: number) => void | Promise<void>;
  private webhookUrl?: string;
  private webhookDispatcher?: WebhookDispatcher;
  private intervalId: NodeJS.Timeout | null = null;
  private accounts: Map<string, SponsorAccountState> = new Map();

  constructor(opts: SponsorMonitorOpts) {
    this.client = opts.client;
    this.sponsorPublicKey = opts.sponsorPublicKey;

    const envMinBalance = process.env.SPONSOR_MIN_BALANCE
      ? parseFloat(process.env.SPONSOR_MIN_BALANCE)
      : undefined;
    this.minBalanceXlm = opts.minBalanceXlm ?? envMinBalance ?? 50;

    const envPollInterval = process.env.SPONSOR_POLL_INTERVAL_MS
      ? parseInt(process.env.SPONSOR_POLL_INTERVAL_MS, 10)
      : undefined;
    this.pollIntervalMs = opts.pollIntervalMs ?? envPollInterval ?? 60000;

    this.onLowBalance = opts.onLowBalance;
    this.webhookUrl = opts.webhookUrl ?? process.env.SPONSOR_ALERT_WEBHOOK_URL;
    this.webhookDispatcher = opts.webhookDispatcher;

    // Register the primary sponsor account first, preserving single-account behaviour.
    this.accounts.set(this.sponsorPublicKey, {
      publicKey: this.sponsorPublicKey,
      minBalanceXlm: this.minBalanceXlm,
      draining: false,
    });

    for (const account of opts.sponsorAccounts ?? []) {
      if (!account.publicKey || this.accounts.has(account.publicKey)) continue;
      this.accounts.set(account.publicKey, {
        publicKey: account.publicKey,
        minBalanceXlm: account.minBalanceXlm ?? this.minBalanceXlm,
        draining: account.draining ?? false,
      });
    }
  }

  /** Snapshot of all monitored sponsor accounts (including draining ones). */
  getAccounts(): SponsorAccountState[] {
    return Array.from(this.accounts.values()).map((a) => ({ ...a }));
  }

  /** Mark an account as draining (rotation out) or active again. */
  setDraining(publicKey: string, draining: boolean): boolean {
    const state = this.accounts.get(publicKey);
    if (!state) return false;
    state.draining = draining;
    return true;
  }

  get isRunning(): boolean {
    return this.intervalId !== null;
  }

  async checkBalance(): Promise<CheckBalanceResult> {
    try {
      return await this.checkAccountBalance(this.sponsorPublicKey);
    } catch (error) {
      logger.error(
        { error, sponsorPublicKey: this.sponsorPublicKey },
        "[SponsorMonitorService] Error loading sponsor account",
      );
      throw error;
    }
  }

  /** Check balances for every monitored sponsor account. Errors are logged, not thrown. */
  async checkAllBalances(): Promise<CheckBalanceResult[]> {
    const results: CheckBalanceResult[] = [];
    for (const state of this.accounts.values()) {
      try {
        results.push(await this.checkAccountBalance(state.publicKey));
      } catch (error) {
        logger.error(
          { error, sponsorPublicKey: state.publicKey },
          "[SponsorMonitorService] Error loading sponsor account",
        );
      }
    }
    return results;
  }

  private async checkAccountBalance(publicKey: string): Promise<CheckBalanceResult> {
    const state = this.accounts.get(publicKey);
    const threshold = state?.minBalanceXlm ?? this.minBalanceXlm;
    const draining = state?.draining ?? false;

    const account = await this.client.horizon.loadAccount(publicKey);
    const nativeBalanceLine = account.balances.find((b) => b.asset_type === "native");

    const balance = nativeBalanceLine ? parseFloat(nativeBalanceLine.balance) : 0;
    const isLow = balance < threshold;

    if (state) {
      state.lastBalance = balance;
      state.lastIsLow = isLow;
    }

    sponsorBalanceXlm.set(balance);

    if (isLow) {
      logger.warn(
        { sponsorPublicKey: publicKey, balance, minBalanceXlm: threshold, draining },
        `Sponsor account balance (${balance} XLM) is below minimum threshold (${threshold} XLM)${
          draining ? " [draining]" : ""
        }`,
      );

      if (this.onLowBalance) {
        try {
          await this.onLowBalance(balance, threshold);
        } catch (err) {
          logger.error(
            { err },
            "[SponsorMonitorService] Error executing onLowBalance alert callback",
          );
        }
      }

      if (this.webhookUrl) {
        try {
          await fetch(this.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "sponsor_low_balance",
              sponsorPublicKey: publicKey,
              balance,
              threshold,
              draining,
              timestamp: new Date().toISOString(),
            }),
          });
        } catch (err) {
          logger.error({ err }, "[SponsorMonitorService] Failed to send webhook alert");
        }
      }

      if (this.webhookDispatcher) {
        try {
          await this.webhookDispatcher.dispatch("balance.low", {
            sponsorPublicKey: publicKey,
            balance,
            threshold,
            draining,
          });
        } catch (err) {
          logger.error(
            { err },
            "[SponsorMonitorService] Failed to dispatch balance.low webhook event",
          );
        }
      }
    }

    return { balance, isLow, threshold, publicKey, draining };
  }

  start(): void {
    if (this.intervalId) return;

    // Trigger initial check asynchronously
    this.checkAllBalances().catch(() => {});

    this.intervalId = setInterval(() => {
      this.checkAllBalances().catch(() => {});
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
