import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import type { LumenClient } from "@lumen/web-sdk";

import { LumenProvider } from "./context.js";
import { useWallet } from "./use-wallet.js";

describe("useWallet", () => {
  it("returns the wallet from the Lumen client", () => {
    const wallet = {} as ReturnType<LumenClient["getWallet"]>;
    const getWallet = vi.fn().mockReturnValue(wallet);

    const client = {
      getWallet,
    } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const { result } = renderHook(() => useWallet("wallet-1"), {
      wrapper,
    });

    expect(result.current.wallet).toBe(wallet);
    expect(getWallet).toHaveBeenCalledWith("wallet-1");
  });

  it("returns undefined when the wallet does not exist", () => {
    const client = {
      getWallet: vi.fn().mockReturnValue(undefined),
    } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const { result } = renderHook(() => useWallet("missing"), {
      wrapper,
    });

    expect(result.current.wallet).toBeUndefined();
  });

  it("refetches the wallet", () => {
    const firstWallet = {} as ReturnType<LumenClient["getWallet"]>;
    const secondWallet = {} as ReturnType<LumenClient["getWallet"]>;

    const getWallet = vi
      .fn()
      .mockReturnValueOnce(firstWallet)
      .mockReturnValueOnce(secondWallet);

    const client = { getWallet } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const { result } = renderHook(() => useWallet("wallet-1"), {
      wrapper,
    });

    expect(result.current.wallet).toBe(firstWallet);

    act(() => {
      result.current.refetch();
    });

    expect(result.current.wallet).toBe(secondWallet);
    expect(getWallet).toHaveBeenCalledTimes(2);
  });

    it("refetches when the wallet ID changes", () => {
    const walletOne = {} as ReturnType<LumenClient["getWallet"]>;
    const walletTwo = {} as ReturnType<LumenClient["getWallet"]>;

    const getWallet = vi
      .fn()
      .mockReturnValueOnce(walletOne)
      .mockReturnValueOnce(walletTwo);

    const client = { getWallet } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const { result, rerender } = renderHook(
      ({ walletId }) => useWallet(walletId),
      {
        initialProps: { walletId: "wallet-1" },
        wrapper,
      }
    );

    expect(result.current.wallet).toBe(walletOne);

    rerender({ walletId: "wallet-2" });

    expect(result.current.wallet).toBe(walletTwo);
    expect(getWallet).toHaveBeenLastCalledWith("wallet-2");
  });

  it("only re-renders when the selected wallet state changes", () => {
    const wallet = {} as ReturnType<LumenClient["getWallet"]>;
    const getWallet = vi.fn().mockReturnValue(wallet);

    const client = { getWallet } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const renderCount = { current: 0 };

    const { result, rerender } = renderHook(
      ({ walletId }) => {
        renderCount.current += 1;
        return useWallet(walletId);
      },
      {
        initialProps: { walletId: "wallet-1" },
        wrapper,
      }
    );

    expect(result.current.wallet).toBe(wallet);
    expect(renderCount.current).toBe(1);

    // Re-rendering with the same wallet ID must not trigger extra renders
    // from the store, since the selected state is unchanged.
    rerender({ walletId: "wallet-1" });

    expect(renderCount.current).toBe(2);
    expect(result.current.wallet).toBe(wallet);
    expect(getWallet).toHaveBeenCalledTimes(1);
  });

  it("re-renders only the consumer whose selected state changed", () => {
    const walletOne = {} as ReturnType<LumenClient["getWallet"]>;
    const walletTwo = {} as ReturnType<LumenClient["getWallet"]>;

    const getWallet = vi.fn((walletId: string) =>
      walletId === "wallet-1" ? walletOne : walletTwo
    );

    const client = { getWallet } as unknown as LumenClient;

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <LumenProvider client={client}>{children}</LumenProvider>
    );

    const renderCounts = { current: { one: 0, two: 0 } };

    const { result } = renderHook(
      () => {
        renderCounts.current.one += 1;
        const one = useWallet("wallet-1");
        renderCounts.current.two += 1;
        const two = useWallet("wallet-2");
        return { one, two };
      },
      { wrapper }
    );

    expect(result.current.one.wallet).toBe(walletOne);
    expect(result.current.two.wallet).toBe(walletTwo);
    expect(renderCounts.current.one).toBe(1);
    expect(renderCounts.current.two).toBe(1);

    act(() => {
      result.current.one.refetch();
    });

    // The wallet-1 consumer updated; the wallet-2 consumer's selected state
    // is unchanged, so its render count must not increase.
    expect(result.current.one.wallet).toBe(walletOne);
    expect(result.current.two.wallet).toBe(walletTwo);
    expect(renderCounts.current.one).toBe(2);
    expect(renderCounts.current.two).toBe(1);
  });
});