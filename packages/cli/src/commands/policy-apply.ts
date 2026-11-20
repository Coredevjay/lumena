import { Command } from "commander";
import fs from "node:fs";

function diffRules(local: unknown, remote: unknown): string {
  const a = JSON.stringify(local, null, 2);
  const b = JSON.stringify(remote, null, 2);
  if (a === b) return "";
  return `--- remote\n+++ file\n${a}\n${b}`;
}

export function createPolicyApplyCommand(
  defaultServerUrl: string,
  isJsonOutput: () => boolean,
): Command {
  return new Command("apply")
    .description("Apply a policy file with optional dry run")
    .requiredOption("-f, --file <path>", "Policy YAML/JSON file")
    .option("--dry-run", "Show diff without applying", false)
    .option("-s, --server <url>", "Lumen server URL", defaultServerUrl)
    .action(async (options) => {
      const body = JSON.parse(fs.readFileSync(options.file, "utf8"));
      const walletId = body.walletId;
      const remoteRes = await fetch(`${options.server}/policy/${walletId}`);
      const remote = remoteRes.ok ? await remoteRes.json() : {};
      const diff = diffRules(body, remote);
      if (options.dryRun) {
        if (isJsonOutput()) {
          console.log(JSON.stringify({ dryRun: true, hasChanges: Boolean(diff), diff }, null, 2));
        } else {
          console.log(diff || "No changes");
        }
        process.exit(diff ? 2 : 0);
        return;
      }
      const res = await fetch(`${options.server}/policy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Apply failed: HTTP ${res.status}`);
      console.log("Policy applied");
    });
}