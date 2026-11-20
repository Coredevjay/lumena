import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LumenToastProvider, useToast } from "./LumenToast.js";

function Probe() {
  const { addToast } = useToast();
  return (
    <button type="button" onClick={() => addToast({ message: "Payment sent", status: "success" })}>
      notify
    </button>
  );
}

describe("LumenToast announcements", () => {
  it("exposes status role for screen readers", async () => {
    render(
      <LumenToastProvider>
        <Probe />
      </LumenToastProvider>,
    );

    expect(screen.getByRole("status", { hidden: true })).toBeInTheDocument();
  });
});