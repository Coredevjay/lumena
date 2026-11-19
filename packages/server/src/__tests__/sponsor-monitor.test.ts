import { describe, it, expect, vi } from "vitest";
import { SponsorMonitorService } from "../fee-sponsor/monitor.js";
import type { StellarClient } from "@lumen/core";

describe("SponsorMonitorService Unit Tests", () => {
  it("detects low balance and triggers alerts", async () => {
    const mockClient = {
      horizon: {
        loadAccount: vi.fn().mockResolvedValue({
          balances: [{ asset_type: "native", balance: "25.0000000" }],
        }),
      },
    } as unknown as StellarClient;

    let onLowBalanceCalled = false;
    let reportedBalance = 0;

    const monitor = new SponsorMonitorService({
      client: mockClient,
      sponsorPublicKey: "GSPONSORPUBLICKEYEXAMPLE1234567890",
      minBalanceXlm: 50,
      pollIntervalMs: 1000,
      onLowBalance: (bal) => {
        onLowBalanceCalled = true;
        reportedBalance = bal;
      },
    });

    const result = await monitor.checkBalance();

    expect(result.isLow).toBe(true);
    expect(result.balance).toBe(25);
    expect(onLowBalanceCalled).toBe(true);
    expect(reportedBalance).toBe(25);
  });

  it("approves balance above threshold", async () => {
    const mockClient = {
      horizon: {
        loadAccount: vi.fn().mockResolvedValue({
          balances: [{ asset_type: "native", balance: "150.0000000" }],
        }),
      },
    } as unknown as StellarClient;

    const monitor = new SponsorMonitorService({
      client: mockClient,
      sponsorPublicKey: "GSPONSORPUBLICKEYEXAMPLE1234567890",
      minBalanceXlm: 50,
    });

    const result = await monitor.checkBalance();

    expect(result.isLow).toBe(false);
    expect(result.balance).toBe(150);
  });

  it("starts and stops polling interval cleanly", () => {
    const mockClient = {
      horizon: {
        loadAccount: vi.fn().mockResolvedValue({
          balances: [{ asset_type: "native", balance: "100.0000000" }],
        }),
      },
    } as unknown as StellarClient;

    const monitor = new SponsorMonitorService({
      client: mockClient,
      sponsorPublicKey: "GSPONSORPUBLICKEYEXAMPLE1234567890",
      pollIntervalMs: 100,
    });

    expect(monitor.isRunning).toBe(false);
    monitor.start();
    expect(monitor.isRunning).toBe(true);
    monitor.stop();
    expect(monitor.isRunning).toBe(false);
  });

  describe("multiple sponsor accounts", () => {
    const accounts = [
      { publicKey: "GSPONSORONE0000000000000000000000000000000000000000000", weight: 3 },
      { publicKey: "GSPONSORTWO0000000000000000000000000000000000000000000", weight: 1 },
    ];

    function makeClient(balances: Record<string, string>) {
      return {
        horizon: {
          loadAccount: vi.fn().mockImplementation((publicKey: string) =>
            Promise.resolve({
              balances: [{ asset_type: "native", balance: balances[publicKey] }],
            }),
          ),
        },
      } as unknown as StellarClient;
    }

    it("checks the balance of each sponsor account independently", async () => {
      const client = makeClient({
        [accounts[0].publicKey]: "150.0000000",
        [accounts[1].publicKey]: "25.0000000",
      });

      const monitor = new SponsorMonitorService({
        client,
        sponsorAccounts: accounts,
        minBalanceXlm: 50,
      });

      const results = await monitor.checkAllBalances();

      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ publicKey: accounts[0].publicKey, balance: 150, isLow: false });
      expect(results[1]).toMatchObject({ publicKey: accounts[1].publicKey, balance: 25, isLow: true });
      expect(client.horizon.loadAccount).toHaveBeenCalledTimes(2);
      expect(client.horizon.loadAccount).toHaveBeenCalledWith(accounts[0].publicKey);
      expect(client.horizon.loadAccount).toHaveBeenCalledWith(accounts[1].publicKey);
    });

    it("triggers a low-balance alert for each account below the threshold", async () => {
      const client = makeClient({
        [accounts[0].publicKey]: "10.0000000",
        [accounts[1].publicKey]: "20.0000000",
      });

      const alerts: Array<{ publicKey: string; balance: number }> = [];

      const monitor = new SponsorMonitorService({
        client,
        sponsorAccounts: accounts,
        minBalanceXlm: 50,
        onLowBalance: (balance, publicKey) => {
          alerts.push({ publicKey, balance });
        },
      });

      await monitor.checkAllBalances();

      expect(alerts).toHaveLength(2);
      expect(alerts).toEqual(
        expect.arrayContaining([
          { publicKey: accounts[0].publicKey, balance: 10 },
          { publicKey: accounts[1].publicKey, balance: 20 },
        ]),
      );
    });

    it("does not alert for accounts above the threshold", async () => {
      const client = makeClient({
        [accounts[0].publicKey]: "150.0000000",
        [accounts[1].publicKey]: "75.0000000",
      });

      const onLowBalance = vi.fn();

      const monitor = new SponsorMonitorService({
        client,
        sponsorAccounts: accounts,
        minBalanceXlm: 50,
        onLowBalance,
      });

      await monitor.checkAllBalances();

      expect(onLowBalance).not.toHaveBeenCalled();
    });

    it("still monitors draining accounts but reports them as draining", async () => {
      const client = makeClient({
        [accounts[0].publicKey]: "150.0000000",
        [accounts[1].publicKey]: "25.0000000",
      });

      const monitor = new SponsorMonitorService({
        client,
        sponsorAccounts: [
          { ...accounts[0], draining: true },
          { ...accounts[1], draining: false },
        ],
        minBalanceXlm: 50,
      });

      const results = await monitor.checkAllBalances();

      expect(client.horizon.loadAccount).toHaveBeenCalledWith(accounts[0].publicKey);
      expect(client.horizon.loadAccount).toHaveBeenCalledWith(accounts[1].publicKey);

      expect(results[0]).toMatchObject({
        publicKey: accounts[0].publicKey,
        balance: 150,
        isLow: false,
        draining: true,
      });
      expect(results[1]).toMatchObject({
        publicKey: accounts[1].publicKey,
        balance: 25,
        isLow: true,
        draining: false,
      });
    });

    it("reports draining accounts in the low-balance alert payload", async () => {
      const client = makeClient({
        [accounts[0].publicKey]: "5.0000000",
        [accounts[1].publicKey]: "100.0000000",
      });

      const alerts: Array<{ publicKey: string; balance: number; draining: boolean }> = [];

      const monitor = new SponsorMonitorService({
        client,
        sponsorAccounts: [
          { ...accounts[0], draining: true },
          { ...accounts[1], draining: false },
        ],
        minBalanceXlm: 50,
        onLowBalance: (balance, publicKey, draining) => {
          alerts.push({ publicKey, balance, draining });
        },
      });

      await monitor.checkAllBalances();

      expect(alerts).toEqual([{ publicKey: accounts[0].publicKey, balance: 5, draining: true }]);
    });
  });
});
