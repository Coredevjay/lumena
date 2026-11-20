import { Command } from "commander";

export interface DoctorResult {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
}

export async function runDoctor(serverUrl: string): Promise<DoctorResult> {
  const checks: DoctorResult["checks"] = [];

  const configOk = Boolean(process.env.LUMEN_SERVER_URL || serverUrl);
  checks.push({ name: "config", ok: configOk, detail: serverUrl });

  try {
    const health = await fetch(`${serverUrl}/health`);
    checks.push({ name: "server-health", ok: health.ok, detail: String(health.status) });
  } catch (err) {
    checks.push({
      name: "server-health",
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  const clockSkewMs = Math.abs(Date.now() - Date.now());
  checks.push({ name: "clock-skew", ok: clockSkewMs < 120_000, detail: `${clockSkewMs}ms` });

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

export function createDoctorCommand(defaultServerUrl: string, isJsonOutput: () => boolean): Command {
  return new Command("doctor")
    .description("Check local environment and server connectivity")
    .option("-s, --server <url>", "Lumen server URL", defaultServerUrl)
    .action(async (options) => {
      const result = await runDoctor(options.server);
      if (isJsonOutput()) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        for (const check of result.checks) {
          console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail ?? ""}`);
        }
      }
      if (!result.ok) process.exit(1);
    });
}