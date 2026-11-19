import type { StellarClient } from "@lumen/core";

export interface SponsorReserveOpts {
  client: StellarClient;
  sponsorPublicKey: string;
  /** Network base reserve in XLM. Defaults to 0.5. */
  baseReserveXlm?: number;
  /** Fetch implementation used to read data entry sponsors. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Reserves the sponsor has locked up for a single wallet. */
export interface WalletReserveEntry {
  address: string;
  /** Whether the sponsor sponsors the account entry itself (2 base reserves). */
  accountSponsored: boolean;
  trustlines: number;
  signers: number;
  dataEntries: number;
  /** Total base reserves sponsored for this wallet. */
  reserves: number;
  lockedXlm: number;
}

export interface SponsorReserveReport {
  sponsor: string;
  /** Horizon `num_sponsoring` for the sponsor account. */
  numSponsoring: number;
  /** Sum of reserves attributed to the reported wallets. */
  trackedReserves: number;
  /** Sponsored reserves not attributed to any reported wallet. */
  untrackedReserves: number;
  baseReserveXlm: number;
  lockedXlm: number;
  wallets: WalletReserveEntry[];
}

interface SponsoredAccountRecord {
  sponsor?: string;
  num_sponsoring?: number;
  balances?: Array<{ asset_type: string; sponsor?: string }>;
  signers?: Array<{ key: string; sponsor?: string }>;
  data_attr?: Record<string, string>;
}

function isNotFound(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 404;
}

function toXlm(reserves: number, baseReserveXlm: number): number {
  return Number((reserves * baseReserveXlm).toFixed(7));
}

/**
 * Per-wallet accounting of base reserves paid by the sponsor account for
 * accounts, trustlines, signers and data entries.
 */
export class SponsorReserveService {
  private client: StellarClient;
  private sponsorPublicKey: string;
  private baseReserveXlm: number;
  private fetchImpl: typeof fetch;

  constructor(opts: SponsorReserveOpts) {
    this.client = opts.client;
    this.sponsorPublicKey = opts.sponsorPublicKey;
    this.baseReserveXlm = opts.baseReserveXlm ?? 0.5;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async getWalletReserves(address: string): Promise<WalletReserveEntry> {
    let account: SponsoredAccountRecord;
    try {
      account = (await this.client.horizon.loadAccount(address)) as unknown as SponsoredAccountRecord;
    } catch (error) {
      if (isNotFound(error)) return this.entry(address, false, 0, 0, 0);
      throw error;
    }

    const sponsor = this.sponsorPublicKey;
    const accountSponsored = account.sponsor === sponsor;
    const trustlines = (account.balances ?? []).filter(
      (b) => b.asset_type !== "native" && b.sponsor === sponsor,
    ).length;
    const signers = (account.signers ?? []).filter((s) => s.sponsor === sponsor).length;

    let dataEntries = 0;
    for (const key of Object.keys(account.data_attr ?? {})) {
      if ((await this.getDataEntrySponsor(address, key)) === sponsor) dataEntries++;
    }

    return this.entry(address, accountSponsored, trustlines, signers, dataEntries);
  }

  async getReport(addresses: string[]): Promise<SponsorReserveReport> {
    const sponsorAccount = (await this.client.horizon.loadAccount(
      this.sponsorPublicKey,
    )) as unknown as SponsoredAccountRecord;
    const numSponsoring = sponsorAccount.num_sponsoring ?? 0;

    const wallets: WalletReserveEntry[] = [];
    for (const address of [...new Set(addresses)]) {
      wallets.push(await this.getWalletReserves(address));
    }

    const trackedReserves = wallets.reduce((sum, w) => sum + w.reserves, 0);
    return {
      sponsor: this.sponsorPublicKey,
      numSponsoring,
      trackedReserves,
      untrackedReserves: Math.max(0, numSponsoring - trackedReserves),
      baseReserveXlm: this.baseReserveXlm,
      lockedXlm: toXlm(trackedReserves, this.baseReserveXlm),
      wallets,
    };
  }

  private async getDataEntrySponsor(address: string, key: string): Promise<string | undefined> {
    const base = this.client.config.horizonUrl.replace(/\/$/, "");
    const response = await this.fetchImpl(
      `${base}/accounts/${address}/data/${encodeURIComponent(key)}`,
    );
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new Error(`Failed to load data entry "${key}" for ${address}: HTTP ${response.status}`);
    }
    const body = (await response.json()) as { sponsor?: string };
    return body.sponsor;
  }

  private entry(
    address: string,
    accountSponsored: boolean,
    trustlines: number,
    signers: number,
    dataEntries: number,
  ): WalletReserveEntry {
    const reserves = (accountSponsored ? 2 : 0) + trustlines + signers + dataEntries;
    return {
      address,
      accountSponsored,
      trustlines,
      signers,
      dataEntries,
      reserves,
      lockedXlm: toXlm(reserves, this.baseReserveXlm),
    };
  }
}
