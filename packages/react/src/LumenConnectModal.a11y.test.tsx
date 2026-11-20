import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { LumenConnectModal } from "./components/LumenConnectModal.js";

vi.mock("./use-create-wallet.js", () => ({
  useCreateWallet: () => ({ createWallet: vi.fn(), loading: false, error: null, reset: vi.fn() }),
}));
vi.mock("./use-create-wallet-with-passkey.js", () => ({
  useCreateWalletWithPasskey: () => ({
    createWalletWithPasskey: vi.fn(),
    loading: false,
    error: null,
    reset: vi.fn(),
  }),
}));

describe("LumenConnectModal a11y", () => {
  it("has no axe violations and restores focus to trigger", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const trigger = document.createElement("button");
    trigger.textContent = "Open wallet";
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <LumenConnectModal open onClose={onClose} onSuccess={vi.fn()} />,
    );

    const results = await axe(screen.getByRole("dialog"));
    expect(results).toHaveNoViolations();

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger);

    unmount();
    trigger.remove();
  });
});