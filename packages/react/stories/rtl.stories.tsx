import type { Meta, StoryObj } from "@storybook/react";
import { LumenWalletCard } from "../src/components/LumenWalletCard.js";
import { LumenThemeProvider } from "../src/theme/LumenThemeProvider.js";

const meta: Meta = {
  title: "Accessibility/RTL",
};
export default meta;

export const RtlWalletCard: StoryObj = {
  render: () => (
    <div dir="rtl" lang="ar" style={{ padding: 16 }}>
      <LumenThemeProvider className="lumen-root">
        <LumenWalletCard walletId="GDALICEIKHNEK4E6E6YBW6DOX7EWS55OF5OEXM62Y2ZKUHX7LKKXUW4E" />
      </LumenThemeProvider>
    </div>
  ),
};