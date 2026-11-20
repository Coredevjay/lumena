import { Command } from "commander";

export function createSponsorStatusCommands(
  defaultServerUrl: string,
  isJsonOutput: () => boolean,
): Command {
  const cmd = new Command("sponsor").description("Sponsor account operations");

  cmd
    .command("status")
    .description("Show sponsor balance and runway")
    .option("-s, --server <url>", "Lumen server URL", defaultServerUrl)
    .action(async (options) => {
      const res = await fetch(`${options.server}/sponsor/status`);
      if (!res.ok) process.exit(1);
      const data = await res.json();
      if (isJsonOutput()) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.table([{ balance: data.balance, currency: data.currency ?? "XLM", active: data.active }]);
      }
    });

  cmd
    .command("history")
    .description("Sponsor refill and burn history")
    .option("-s, --server <url>", "Lumen server URL", defaultServerUrl)
    .action(async (options) => {
      const res = await fetch(`${options.server}/sponsor/history`);
      const data = res.ok ? await res.json() : [];
      console.log(isJsonOutput() ? JSON.stringify(data, null, 2) : JSON.stringify(data, null, 2));
    });

  return cmd;
}