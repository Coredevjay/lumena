import { createHash } from "node:crypto";
import fs from "node:fs";

export function verifyAuditLog(manifestPath: string, logPath: string): boolean {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { root?: string };
  const lines = fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const computed = createHash("sha256")
    .update(lines.map((e) => JSON.stringify(e)).join("\n"))
    .digest("hex");
  if (manifest.root && manifest.root !== computed) {
    throw new Error(`Merkle root mismatch: expected ${manifest.root}, got ${computed}`);
  }
  return true;
}