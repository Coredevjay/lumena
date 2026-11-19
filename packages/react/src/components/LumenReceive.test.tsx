import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import jsQR from "jsqr";
import { LumenReceive, buildSep7PayUri } from "./LumenReceive.js";
import { parseQrPayload } from "./LumenQrScanner.js";

const ADDRESS = "GDLG3LO3ILCROFOFASXRWYNO2RHSGHA2BHK3M4PGELIL33WM63HCR7UA";

/** Rasterises the rendered QR SVG path and decodes it with jsQR. */
function scanRenderedQr(): string | null {
  const svg = screen.getByTestId("lumen-receive-qr");
  const dimension = Number(svg.getAttribute("viewBox")?.split(" ")[2]);
  const d = svg.querySelector("path")?.getAttribute("d") ?? "";
  const scale = 4;
  const size = dimension * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  for (const match of d.matchAll(/M(\d+) (\d+)/g)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const i = ((y * scale + dy) * size + (x * scale + dx)) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = 0;
      }
    }
  }
  return jsQR(pixels, size, size)?.data ?? null;
}

describe("buildSep7PayUri", () => {
  it("omits empty optional fields", () => {
    expect(buildSep7PayUri({ destination: ADDRESS, amount: " ", memo: "" })).toBe(
      `web+stellar:pay?destination=${ADDRESS}`,
    );
  });

  it("encodes amount, asset and text memo", () => {
    const uri = buildSep7PayUri({
      destination: ADDRESS,
      amount: "5",
      memo: "rent june",
      assetCode: "USDC",
      assetIssuer: ADDRESS,
    });
    expect(uri).toContain("amount=5");
    expect(uri).toContain("memo=rent%20june");
    expect(uri).toContain("memo_type=MEMO_TEXT");
    expect(uri).toContain("asset_code=USDC");
  });
});

describe("LumenReceive", () => {
  it("round-trips the address through a QR scan", () => {
    render(<LumenReceive address={ADDRESS} />);
    const decoded = scanRenderedQr();
    expect(decoded).not.toBeNull();
    const result = parseQrPayload(decoded as string);
    expect(result.type).toBe("sep0007");
    expect(result.destination).toBe(ADDRESS);
    expect(result.amount).toBeUndefined();
  });

  it("round-trips amount and memo after editing the fields", () => {
    render(<LumenReceive address={ADDRESS} />);
    fireEvent.change(screen.getByLabelText("Amount (optional)"), { target: { value: "12.5" } });
    fireEvent.change(screen.getByLabelText("Memo (optional)"), { target: { value: "invoice 42" } });

    const result = parseQrPayload(scanRenderedQr() as string);
    expect(result.destination).toBe(ADDRESS);
    expect(result.amount).toBe("12.5");
    expect(result.memo).toBe("invoice 42");
    expect(result.memoType).toBe("MEMO_TEXT");
  });

  it("exposes accessible labels", () => {
    render(<LumenReceive address={ADDRESS} />);
    expect(screen.getByRole("region", { name: "Receive payment" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: `Payment QR code for ${ADDRESS}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy wallet address" })).toBeInTheDocument();
    expect(screen.getByLabelText("Amount (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Memo (optional)")).toBeInTheDocument();
  });

  it("hides optional fields when disabled", () => {
    render(<LumenReceive address={ADDRESS} showAmount={false} showMemo={false} />);
    expect(screen.queryByLabelText("Amount (optional)")).toBeNull();
    expect(screen.queryByLabelText("Memo (optional)")).toBeNull();
  });

  it("copies the address to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onCopy = vi.fn();
    render(<LumenReceive address={ADDRESS} onCopy={onCopy} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy wallet address" }));

    await waitFor(() => expect(onCopy).toHaveBeenCalledWith(ADDRESS));
    expect(writeText).toHaveBeenCalledWith(ADDRESS);
    expect(screen.getByRole("button", { name: "Address copied" })).toBeInTheDocument();
  });
});
