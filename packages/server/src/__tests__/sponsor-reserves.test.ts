import { describe, it, expect, vi } from "vitest";
import { SponsorReserveService } from "../fee-sponsor/reserves.js";
import type { StellarClient } from "@lumen/core";

const SPONSOR = "GSPONSORPUBLICKEYEXAMPLE1234567890";
const OTHER = "GOTHERSPONSOREXAMPLE1234567890";
const WALLET_A = "GWALLETAEXAMPLE1234567890";
const WALLET_B = "GWALLETBEXAMPLE1234567890";
const MERGED = "GMERGEDWALLETEXAMPLE1234567890";

const accounts: Record<string, unknown> = {
  [SPONSOR]: { num_sponsoring: 7, balances: [], signers: [] },
  [WALLET_A]: {
    sponsor: SPONSOR,
    balances: [
      { asset_type: "native" },
      { asset_type: "credit_alphanum4", sponsor: SPONSOR },
      { asset_type: "credit_alphanum4", sponsor: OTHER },
    ],
    signers: [
      { key: WALLET_A },
      { key: "GSERVERCOSIGNER", sponsor: SPONSOR },
    ],
    data_attr: { "config.memo_required": "MQ==", nickname: "YWxpY2U=" },
  },
  [WALLET_B]: {
    sponsor: SPONSOR,
    balances: [{ asset_type: "native" }],
    signers: [{ key: WALLET_B }],
  },
};

function createService() {
  const client = {
    config: { horizonUrl: "https://horizon-testnet.stellar.org/" },
    horizon: {
      loadAccount: vi.fn(async (address: string) => {
        if (!(address in accounts)) {
          throw Object.assign(new Error("Not Found"), { response: { status: 404 } });
        }
        return accounts[address];
      }),
    },
  } as unknown as StellarClient;

  const dataSponsors: Record<string, string | undefined> = {
    [`${WALLET_A}/config.memo_required`]: SPONSOR,
    [`${WALLET_A}/nickname`]: undefined,
  };
  const fetchImpl = vi.fn(async (url: string) => {
    const match = /\/accounts\/([^/]+)\/data\/(.+)$/.exec(url);
    const key = `${match?.[1]}/${decodeURIComponent(match?.[2] ?? "")}`;
    return new Response(JSON.stringify({ value: "", sponsor: dataSponsors[key] }), {
      status: 200,
    });
  }) as unknown as typeof fetch;

  return {
    service: new SponsorReserveService({ client, sponsorPublicKey: SPONSOR, fetchImpl }),
    fetchImpl,
  };
}

describe("SponsorReserveService", () => {
  it("counts reserves sponsored for a wallet by entry type", async () => {
    const { service, fetchImpl } = createService();

    const entry = await service.getWalletReserves(WALLET_A);

    expect(entry).toEqual({
      address: WALLET_A,
      accountSponsored: true,
      trustlines: 1,
      signers: 1,
      dataEntries: 1,
      reserves: 5,
      lockedXlm: 2.5,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://horizon-testnet.stellar.org/accounts/${WALLET_A}/data/config.memo_required`,
    );
  });

  it("matches Horizon num_sponsoring across all wallets", async () => {
    const { service } = createService();

    const report = await service.getReport([WALLET_A, WALLET_B, WALLET_A]);

    expect(report.wallets.map((w) => w.reserves)).toEqual([5, 2]);
    expect(report.trackedReserves).toBe(7);
    expect(report.numSponsoring).toBe(7);
    expect(report.trackedReserves).toBe(report.numSponsoring);
    expect(report.untrackedReserves).toBe(0);
    expect(report.lockedXlm).toBe(3.5);
  });

  it("reports untracked reserves when wallets are missing from the report", async () => {
    const { service } = createService();

    const report = await service.getReport([WALLET_B]);

    expect(report.trackedReserves).toBe(2);
    expect(report.untrackedReserves).toBe(5);
  });

  it("treats merged or missing accounts as holding no reserves", async () => {
    const { service } = createService();

    const entry = await service.getWalletReserves(MERGED);

    expect(entry.reserves).toBe(0);
    expect(entry.accountSponsored).toBe(false);
  });
});
