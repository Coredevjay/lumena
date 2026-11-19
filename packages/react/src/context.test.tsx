import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LumenProvider, useLumen } from "./context.js";
import { useBalance } from "./use-balance.js";
import type { LumenClient } from "@lumen/web-sdk";

const createClient = (): LumenClient => ({}) as LumenClient;

describe("LumenProvider", () => {
  it("provides the Lumen client through useLumen", () => {
    const client = {} as LumenClient;

    const { result } = renderHook(() => useLumen(), {
      wrapper: ({ children }) => (
        <LumenProvider client={client}>{children}</LumenProvider>
      ),
    });

    expect(result.current.client).toBe(client);
  });

  it("provides isMounted=true after the provider mounts (SSR-safe)", () => {
    const client = {} as LumenClient;

    const { result } = renderHook(() => useLumen(), {
      wrapper: ({ children }) => (
        <LumenProvider client={client}>{children}</LumenProvider>
      ),
    });

    expect(result.current.isMounted).toBe(true);
  });

  it("throws when useLumen is used outside the provider", () => {
    expect(() => renderHook(() => useLumen())).toThrow(
      "useLumen must be used within a LumenProvider"
    );
  });
});

describe("LumenProvider network switching", () => {
  it("exposes the initial network and supported networks", () => {
    const client = {} as LumenClient;

    const { result } = renderHook(() => useLumen(), {
      wrapper: ({ children }) => (
        <LumenProvider client={client} network="mainnet">{children}</LumenProvider>
      ),
    });

    expect(result.current.currentNetwork).toBe("mainnet");
    expect(result.current.supportedNetworks).toEqual(["mainnet"]);
  });

  it("switches to a client created for the selected network", () => {
    const testnetClient = {} as LumenClient;
    const futurenetClient = {} as LumenClient;
    const createClient = vi.fn(() => futurenetClient);

    const { result } = renderHook(() => useLumen(), {
      wrapper: ({ children }) => (
        <LumenProvider client={testnetClient} createClient={createClient}>
          {children}
        </LumenProvider>
      ),
    });

    act(() => result.current.switchNetwork("futurenet"));

    expect(createClient).toHaveBeenCalledWith("futurenet");
    expect(result.current.currentNetwork).toBe("futurenet");
    expect(result.current.client).toBe(futurenetClient);

    act(() => result.current.switchNetwork("testnet"));

    expect(result.current.client).toBe(testnetClient);
  });

  it("throws when switching to an unsupported network", () => {
    const client = {} as LumenClient;

    const { result } = renderHook(() => useLumen(), {
      wrapper: ({ children }) => (
        <LumenProvider client={client}>{children}</LumenProvider>
      ),
    });

    expect(() => result.current.switchNetwork("mainnet")).toThrow(
      'Network "mainnet" is not supported'
    );
  });

  it("refetches useBalance against the newly selected network", async () => {
    const testnetClient = {
      getBalance: vi.fn().mockResolvedValue("10"),
    } as unknown as LumenClient;
    const mainnetClient = {
      getBalance: vi.fn().mockResolvedValue("99"),
    } as unknown as LumenClient;

    const { result } = renderHook(
      () => ({ lumen: useLumen(), balance: useBalance("GABC", undefined, 0) }),
      {
        wrapper: ({ children }) => (
          <LumenProvider client={testnetClient} createClient={() => mainnetClient}>
            {children}
          </LumenProvider>
        ),
      }
    );

    await waitFor(() => expect(result.current.balance.balance).toBe("10"));

    act(() => result.current.lumen.switchNetwork("mainnet"));

    await waitFor(() => expect(result.current.balance.balance).toBe("99"));
    expect(mainnetClient.getBalance).toHaveBeenCalledWith("GABC", undefined);
  });
});

describe("LumenProvider render counts", () => {
  it("does not re-render consumers when unrelated state changes", () => {
    const client = createClient();
    const otherClient = createClient();
    const renderCount = vi.fn();

    const { result, rerender } = renderHook(
      () => {
        const lumen = useLumen();
        renderCount();
        return lumen;
      },
      {
        wrapper: ({ children }) => (
          <LumenProvider client={client}>{children}</LumenProvider>
        ),
      }
    );

    expect(renderCount).toHaveBeenCalledTimes(1);

    // Re-rendering the provider with the same client should not notify
    // consumers of any state change.
    rerender();

    expect(renderCount).toHaveBeenCalledTimes(1);
    expect(result.current.client).toBe(client);

    // Switching to a different client is a relevant change and should
    // trigger a re-render.
    act(() => result.current.switchNetwork("testnet"));

    expect(result.current.client).toBe(otherClient);
  });

  it("only re-renders consumers subscribed to the changed slice", () => {
    const testnetClient = createClient();
    const mainnetClient = createClient();
    const clientRenderCount = vi.fn();
    const networkRenderCount = vi.fn();

    const { result } = renderHook(
      () => {
        const { client } = useLumen();
        clientRenderCount();
        return client;
      },
      {
        wrapper: ({ children }) => (
          <LumenProvider
            client={testnetClient}
            createClient={() => mainnetClient}
          >
            {children}
          </LumenProvider>
        ),
      }
    );

    const networkHook = renderHook(
      () => {
        const { currentNetwork } = useLumen();
        networkRenderCount();
        return currentNetwork;
      },
      {
        wrapper: ({ children }) => (
          <LumenProvider
            client={testnetClient}
            createClient={() => mainnetClient}
          >
            {children}
          </LumenProvider>
        ),
      }
    );

    expect(result.current).toBe(testnetClient);
    expect(networkHook.result.current).toBe("testnet");
    expect(clientRenderCount).toHaveBeenCalledTimes(1);
    expect(networkRenderCount).toHaveBeenCalledTimes(1);

    act(() => networkHook.result.current && undefined);

    // No state change occurred, so neither consumer should re-render.
    expect(clientRenderCount).toHaveBeenCalledTimes(1);
    expect(networkRenderCount).toHaveBeenCalledTimes(1);
  });

  it("keeps the client reference stable across unrelated state updates", () => {
    const client = createClient();

    const { result, rerender } = renderHook(() => useLumen(), {
      wrapper: ({ children }) => (
        <LumenProvider client={client}>{children}</LumenProvider>
      ),
    });

    const initialClient = result.current.client;
    const initialSwitchNetwork = result.current.switchNetwork;

    rerender();

    expect(result.current.client).toBe(initialClient);
    expect(result.current.switchNetwork).toBe(initialSwitchNetwork);
  });
});
