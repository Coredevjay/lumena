import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAsyncResource } from "./use-async-resource.js";

describe("useAsyncResource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads data and supports abort on unmount", async () => {
    const fetcher = vi.fn(async () => "ok");
    const { result, unmount } = renderHook(() =>
      useAsyncResource({ fetcher, pollInterval: 0 }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBe("ok");
    expect(fetcher).toHaveBeenCalledTimes(1);

    unmount();
    const signal = fetcher.mock.calls[0][0] as AbortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("polls on an interval", async () => {
    const fetcher = vi.fn(async () => 1);
    renderHook(() =>
      useAsyncResource({ fetcher, pollInterval: 1000, refetchOnFocus: false }),
    );

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(1000);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});