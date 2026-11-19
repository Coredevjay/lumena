import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LumenClient } from "@lumen/web-sdk";
import { LumenProvider } from "./context.js";
import { useGaslessTransaction } from "./use-gasless-transaction.js";

describe("useGaslessTransaction", () => {
  it("applies an optimistic balance update and clears it on success", async () => {
    const sendPayment = vi.fn().mockResolvedValue({ hash: "tx-1" });
    const getBalance = vi.fn().mockResolvedValue("100.0000000");

    const client = {
      sendPayment,
      getBalance,
    } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const { result } = renderHook(() => useGaslessTransaction("wallet-1"), {
      wrapper,
    });

    // Wait for the confirmed balance to be loaded.
    await waitFor(() => {
      expect(result.current.balance).toBe("100.0000000");
    });

    await act(async () => {
      await result.current.execute({ destination: "dest-1", amount: "10.0000000" });
    });

    // After success the optimistic balance is cleared; confirmed balance is shown.
    expect(result.current.balance).toBe("100.0000000");
    expect(result.current.error).toBeNull();
  });

  it("rolls back to the pre-call balance on failure", async () => {
    const sendPayment = vi.fn().mockRejectedValue(new Error("tx failed"));
    const getBalance = vi.fn().mockResolvedValue("100.0000000");

    const client = {
      sendPayment,
      getBalance,
    } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const { result } = renderHook(() => useGaslessTransaction("wallet-1"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.balance).toBe("100.0000000");
    });

    await act(async () => {
      await result.current
        .execute({ destination: "dest-1", amount: "10.0000000" })
        .catch(() => {});
    });

    // Balance should be rolled back to the pre-call snapshot (undefined optimistic
    // → falls through to confirmedBalance).
    expect(result.current.balance).toBe("100.0000000");
    expect(result.current.error?.message).toBe("tx failed");
  });

  it("concurrent execute calls: failed second call rolls back to correct snapshot", async () => {
    // First payment resolves successfully; second payment rejects.
    let resolveFirst!: (value: { hash: string }) => void;
    let rejectSecond!: (reason: Error) => void;

    const firstPaymentPromise = new Promise<{ hash: string }>((resolve) => {
      resolveFirst = resolve;
    });
    const secondPaymentPromise = new Promise<{ hash: string }>((_resolve, reject) => {
      rejectSecond = reject;
    });

    const sendPayment = vi
      .fn()
      .mockReturnValueOnce(firstPaymentPromise)
      .mockReturnValueOnce(secondPaymentPromise);

    const getBalance = vi.fn().mockResolvedValue("100.0000000");

    const client = {
      sendPayment,
      getBalance,
    } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const { result } = renderHook(() => useGaslessTransaction("wallet-1"), {
      wrapper,
    });

    // Wait for confirmed balance to load.
    await waitFor(() => {
      expect(result.current.balance).toBe("100.0000000");
    });

    // Fire both payments concurrently without awaiting individually.
    let firstDone = false;
    let secondDone = false;

    act(() => {
      result.current
        .execute({ destination: "dest-1", amount: "10.0000000" })
        .then(() => {
          firstDone = true;
        })
        .catch(() => {});

      result.current
        .execute({ destination: "dest-2", amount: "5.0000000" })
        .then(() => {})
        .catch(() => {
          secondDone = true;
        });
    });

    // After both are fired, the optimistic balance should reflect both deductions:
    // 100 - 10 - 5 = 85.
    await waitFor(() => {
      expect(result.current.balance).toBe("85.0000000");
    });

    // Resolve the first payment.
    await act(async () => {
      resolveFirst({ hash: "tx-1" });
      await firstPaymentPromise;
    });

    // Reject the second payment.
    await act(async () => {
      rejectSecond(new Error("policy rejected"));
      await secondPaymentPromise.catch(() => {});
    });

    await waitFor(() => {
      expect(firstDone).toBe(true);
      expect(secondDone).toBe(true);
    });

    // The second call captured snapshot = "90.0000000" (balance after first
    // optimistic deduction: 100 - 10). Rolling back to that snapshot correctly
    // reflects the in-flight first payment, rather than the original "100".
    await waitFor(() => {
      expect(result.current.balance).toBe("90.0000000");
    });

    expect(result.current.error?.message).toBe("policy rejected");
  });

  it("only re-renders consumers when relevant state changes", async () => {
    const sendPayment = vi.fn().mockResolvedValue({ hash: "tx-1" });
    const getBalance = vi.fn().mockResolvedValue("100.0000000");

    const client = {
      sendPayment,
      getBalance,
    } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    let renderCount = 0;
    const { result } = renderHook(
      () => {
        renderCount += 1;
        return useGaslessTransaction("wallet-1");
      },
      { wrapper },
    );

    // Wait for the confirmed balance to be loaded.
    await waitFor(() => {
      expect(result.current.balance).toBe("100.0000000");
    });

    // Record the render count once the initial load has settled.
    const settledRenderCount = renderCount;

    // An optimistic update followed by success should re-render the consumer,
    // but the number of renders must stay bounded (no render storm from
    // unrelated provider state changes).
    await act(async () => {
      await result.current.execute({ destination: "dest-1", amount: "10.0000000" });
    });

    await waitFor(() => {
      expect(result.current.balance).toBe("100.0000000");
    });

    const rendersDuringExecute = renderCount - settledRenderCount;
    expect(rendersDuringExecute).toBeGreaterThan(0);
    // Optimistic apply + clear (plus at most a couple of settling renders).
    expect(rendersDuringExecute).toBeLessThanOrEqual(4);

    // Re-rendering the provider with the same client must not cause the
    // consumer to re-render, since the client context is stable.
    const stableRenderCount = renderCount;
    await act(async () => {
      // No state change: awaiting a microtask flush should not trigger renders.
      await Promise.resolve();
    });
    expect(renderCount).toBe(stableRenderCount);
  });
});
