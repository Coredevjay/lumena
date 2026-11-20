import type { Meta, StoryObj } from "@storybook/react";
import React, { useState } from "react";
import { LumenThemeProvider } from "../src/theme/LumenThemeProvider.js";
import "../docs/theme.css";

const meta: Meta = {
  title: "Theming/Playground",
};
export default meta;

export const LiveTokens: StoryObj = {
  render: () => {
    const [primary, setPrimary] = useState("#4f46e5");
    return (
      <LumenThemeProvider
        className="lumen-root"
        style={{ ["--lumen-primary" as string]: primary, padding: 24 }}
      >
        <label>
          Primary color
          <input type="color" value={primary} onChange={(e) => setPrimary(e.target.value)} />
        </label>
        <button type="button" style={{ background: "var(--lumen-primary)", color: "#fff", padding: 12 }}>
          Sample button
        </button>
      </LumenThemeProvider>
    );
  },
};