import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LumenClient } from "@lumen/web-sdk";

import { LumenProvider, useLumenStore } from "./context.js";
import { useSendPayment } from "./use-send-payment.js";

describe("useSendPayment", () => {
  it("sends a payment successfully", async () => {
    const sendPayment = vi.fn().mockResolvedValue({
      hash: "tx-123",
    });

    const client = {
      sendPayment,
    } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const { result } = renderHook(() => useSendPayment(), {
      wrapper,
    });

    let response;

    await act(async () => {
      response = await result.current.sendPayment({
        walletId: "wallet-1",
        destination: "destination-1",
        assetCode: "XLM",
        amount: "10",
      });
    });

    expect(response).toEqual({ hash: "tx-123" });
    expect(result.current.data).toEqual({ hash: "tx-123" });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);

    expect(sendPayment).toHaveBeenCalledWith(
      "wallet-1",
      "destination-1",
      "XLM",
      "10"
    );
  });

  it("handles payment errors", async () => {
    const sendPayment = vi
      .fn()
      .mockRejectedValue(new Error("Payment failed"));

    const client = {
      sendPayment,
    } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const { result } = renderHook(() => useSendPayment(), {
      wrapper,
    });

    await act(async () => {
      await expect(
        result.current.sendPayment({
          walletId: "wallet-1",
          destination: "destination-1",
          assetCode: "XLM",
          amount: "10",
        })
      ).rejects.toThrow("Payment failed");
    });

    expect(result.current.error?.message).toBe("Payment failed");
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("resets payment state", async () => {
    const sendPayment = vi.fn().mockResolvedValue({
      hash: "tx-123",
    });

    const client = {
      sendPayment,
    } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const { result } = renderHook(() => useSendPayment(), {
      wrapper,
    });

    await act(async () => {
      await result.current.sendPayment({
        walletId: "wallet-1",
        destination: "destination-1",
        assetCode: "XLM",
        amount: "10",
      });
    });

    expect(result.current.data).toEqual({ hash: "tx-123" });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("only re-renders when relevant state changes", async () => {
    const sendPayment = vi.fn().mockResolvedValue({
      hash: "tx-123",
    });

    const client = {
      sendPayment,
    } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    let renderCount = 0;

    const { result } = renderHook(
      () => {
        renderCount += 1;
        return useSendPayment();
      },
      { wrapper }
    );

    const initialRenderCount = renderCount;

    // Unrelated store updates must not re-render the hook consumer.
    act(() => {
      useLumenStore.getState().setNetwork("testnet");
    });

    expect(renderCount).toBe(initialRenderCount);

    // Relevant state changes (payment state) do re-render the consumer.
    await act(async () => {
      await result.current.sendPayment({
        walletId: "wallet-1",
        destination: "destination-1",
        assetCode: "XLM",
        amount: "10",
      });
    });

    expect(renderCount).toBeGreaterThan(initialRenderCount);
    expect(result.current.data).toEqual({ hash: "tx-123" });
  });
});