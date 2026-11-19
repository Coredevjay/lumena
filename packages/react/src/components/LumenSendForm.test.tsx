import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import axe from "axe-core";
import { LumenSendForm, isFederationAddress } from "./LumenSendForm.js";

const DESTINATION = "GDLG3LO3ILCROFOFASXRWYNO2RHSGHA2BHK3M4PGELIL33WM63HCR7UA";
const MUXED = "MDLG3LO3ILCROFOFASXRWYNO2RHSGHA2BHK3M4PGELIL33WM63HCQAAAAAAAAAAAFJ7KO";

function renderForm(props: Partial<React.ComponentProps<typeof LumenSendForm>> = {}) {
  const onSubmit = vi.fn().mockResolvedValue({ hash: "abc123" });
  const isMemoRequired = vi.fn().mockResolvedValue(false);
  const utils = render(
    <LumenSendForm onSubmit={onSubmit} isMemoRequired={isMemoRequired} {...props} />,
  );
  return { ...utils, onSubmit, isMemoRequired };
}

function fill({ destination = "", amount = "", memo = "" }) {
  fireEvent.change(screen.getByLabelText("Destination"), { target: { value: destination } });
  fireEvent.change(screen.getByLabelText("Amount (XLM)"), { target: { value: amount } });
  if (memo) fireEvent.change(screen.getByLabelText("Memo (optional)"), { target: { value: memo } });
}

describe("isFederationAddress", () => {
  it("detects name*domain addresses", () => {
    expect(isFederationAddress("alice*example.com")).toBe(true);
    expect(isFederationAddress(DESTINATION)).toBe(false);
  });
});

describe("LumenSendForm", () => {
  it("has no critical or serious accessibility violations", async () => {
    const { container } = renderForm();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    const serious = results.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(serious.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
  });

  it("shows field errors for invalid input", async () => {
    renderForm();
    fill({ destination: "not-an-address", amount: "-1" });
    fireEvent.click(screen.getByRole("button", { name: "Review payment" }));

    expect(await screen.findByText(/Enter a valid G\.\.\. or M\.\.\. address/)).toBeInTheDocument();
    expect(screen.getByText(/Enter a positive amount/)).toBeInTheDocument();
    expect(screen.getByLabelText("Destination")).toHaveAttribute("aria-invalid", "true");
  });

  it("reviews and submits a payment", async () => {
    const { onSubmit } = renderForm();
    fill({ destination: DESTINATION, amount: "10.5", memo: "rent" });
    fireEvent.click(screen.getByRole("button", { name: "Review payment" }));

    expect(await screen.findByRole("region", { name: "Review payment" })).toBeInTheDocument();
    expect(screen.getByText("10.5 XLM")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and send" }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        destination: DESTINATION,
        destinationInput: DESTINATION,
        amount: "10.5",
        assetCode: "XLM",
        memo: "rent",
        memoType: "text",
      }),
    );
    expect(await screen.findByText("abc123")).toBeInTheDocument();
  });

  it("warns when the destination requires a memo", async () => {
    const { onSubmit } = renderForm({ isMemoRequired: vi.fn().mockResolvedValue(true) });
    fill({ destination: DESTINATION, amount: "1" });
    fireEvent.click(screen.getByRole("button", { name: "Review payment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This destination requires a memo");
    expect(screen.queryByRole("region", { name: "Review payment" })).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("accepts muxed addresses without a memo check", async () => {
    const { isMemoRequired } = renderForm();
    fill({ destination: MUXED, amount: "2" });
    fireEvent.click(screen.getByRole("button", { name: "Review payment" }));

    expect(await screen.findByRole("region", { name: "Review payment" })).toBeInTheDocument();
    expect(isMemoRequired).not.toHaveBeenCalled();
  });

  it("resolves federation addresses and applies the returned memo", async () => {
    const resolveFederation = vi
      .fn()
      .mockResolvedValue({ accountId: DESTINATION, memo: "42", memoType: "id" });
    const { onSubmit } = renderForm({ resolveFederation });
    fill({ destination: "alice*example.com", amount: "3" });
    fireEvent.click(screen.getByRole("button", { name: "Review payment" }));

    expect(await screen.findByRole("region", { name: "Review payment" })).toBeInTheDocument();
    expect(resolveFederation).toHaveBeenCalledWith("alice*example.com");
    expect(screen.getByText(DESTINATION)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm and send" }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          destination: DESTINATION,
          destinationInput: "alice*example.com",
          memo: "42",
          memoType: "id",
        }),
      ),
    );
  });

  it("shows submission errors on the review step", async () => {
    renderForm({ onSubmit: vi.fn().mockRejectedValue(new Error("Cosign rejected")) });
    fill({ destination: DESTINATION, amount: "1" });
    fireEvent.click(screen.getByRole("button", { name: "Review payment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm and send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cosign rejected");
  });
});
