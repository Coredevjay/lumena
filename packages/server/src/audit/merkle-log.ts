import { createHash } from "node:crypto";

export interface SimulationFootprintEntry {
  type: string;
  value: string;
}

export interface SimulationSummary {
  successful: boolean;
  minResourceFee: string;
  cpuInstructions: string;
  memoryBytes: string;
  footprint: readonly SimulationFootprintEntry[];
  error?: string;
}

export interface AuditRecord {
  prevHash: string;
  timestamp: string;
  txHash: string;
  walletAddress: string;
  decision: "approved" | "rejected";
  rulesEvaluated: readonly string[];
  simulation?: SimulationSummary;
  hash: string;
}

export interface AuditDecision {
  timestamp?: string;
  txHash: string;
  walletAddress: string;
  decision: "approved" | "rejected";
  rulesEvaluated: string[];
  simulation?: SimulationSummary;
}

export interface AuditLogStorage {
  load(): Promise<AuditRecord[]>;
  append(record: AuditRecord): Promise<boolean>;
}

function parseSimulationSummary(value: unknown): SimulationSummary {
  if (!value || typeof value !== "object") {
    throw new Error("Stored audit record has an invalid simulation summary");
  }
  const summary = value as Record<string, unknown>;
  if (
    typeof summary.successful !== "boolean" ||
    typeof summary.minResourceFee !== "string" ||
    typeof summary.cpuInstructions !== "string" ||
    typeof summary.memoryBytes !== "string" ||
    !Array.isArray(summary.footprint) ||
    !summary.footprint.every(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as Record<string, unknown>).type === "string" &&
        typeof (entry as Record<string, unknown>).value === "string",
    ) ||
    (summary.error !== undefined && typeof summary.error !== "string")
  ) {
    throw new Error("Stored audit record has an invalid simulation summary");
  }
  return Object.freeze({
    successful: summary.successful,
    minResourceFee: summary.minResourceFee,
    cpuInstructions: summary.cpuInstructions,
    memoryBytes: summary.memoryBytes,
    footprint: Object.freeze(
      summary.footprint.map((entry) =>
        Object.freeze({
          type: (entry as SimulationFootprintEntry).type,
          value: (entry as SimulationFootprintEntry).value,
        }),
      ),
    ),
    ...(summary.error !== undefined ? { error: summary.error } : {}),
  });
}

export function parseAuditRecord(raw: string): AuditRecord {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object") {
    throw new Error("Stored audit record is not an object");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.prevHash !== "string" ||
    typeof record.timestamp !== "string" ||
    typeof record.txHash !== "string" ||
    typeof record.walletAddress !== "string" ||
    (record.decision !== "approved" && record.decision !== "rejected") ||
    !Array.isArray(record.rulesEvaluated) ||
    !record.rulesEvaluated.every((rule) => typeof rule === "string") ||
    typeof record.hash !== "string"
  ) {
    throw new Error("Stored audit record has an invalid shape");
  }
  return Object.freeze({
    prevHash: record.prevHash,
    timestamp: record.timestamp,
    txHash: record.txHash,
    walletAddress: record.walletAddress,
    decision: record.decision,
    rulesEvaluated: Object.freeze([...record.rulesEvaluated]),
    ...(record.simulation !== undefined
      ? { simulation: parseSimulationSummary(record.simulation) }
      : {}),
    hash: record.hash,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashRecord(record: Omit<AuditRecord, "hash">): string {
  return sha256(JSON.stringify(record));
}

export class MerkleAuditLog {
  private readonly records: AuditRecord[] = [];
  private readonly storage?: AuditLogStorage;
  private readonly loading: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(storage?: AuditLogStorage) {
    this.storage = storage;
    this.loading = storage
      ? storage.load().then((records) => {
          if (!this.verify(records)) {
            throw new Error("Stored audit log failed hash-chain verification");
          }
          this.records.push(...records);
        })
      : Promise.resolve();
  }

  async ready(): Promise<void> {
    await this.loading;
  }

  append(decision: AuditDecision): Promise<AuditRecord> {
    const append = this.writeQueue.then(async () => {
      await this.loading;
      for (let attempt = 0; attempt < 10; attempt++) {
        const data: Omit<AuditRecord, "hash"> = {
          prevHash: this.records.at(-1)?.hash ?? "",
          timestamp: decision.timestamp ?? new Date().toISOString(),
          txHash: decision.txHash,
          walletAddress: decision.walletAddress,
          decision: decision.decision,
          rulesEvaluated: Object.freeze([...decision.rulesEvaluated]),
          ...(decision.simulation !== undefined
            ? { simulation: parseSimulationSummary(decision.simulation) }
            : {}),
        };
        const record = Object.freeze({ ...data, hash: hashRecord(data) });
        if (!this.storage || (await this.storage.append(record))) {
          this.records.push(record);
          return record;
        }

        const storedRecords = await this.storage.load();
        if (!this.verify(storedRecords)) {
          throw new Error("Stored audit log failed hash-chain verification");
        }
        this.records.splice(0, this.records.length, ...storedRecords);
      }
      throw new Error("Unable to append to audit log after concurrent updates");
    });
    this.writeQueue = append.then(
      () => undefined,
      () => undefined,
    );
    return append;
  }

  getRecords(): readonly AuditRecord[] {
    return Object.freeze([...this.records]);
  }

  verify(records: readonly AuditRecord[] = this.records): boolean {
    let previousHash = "";
    for (const record of records) {
      const { hash, ...data } = record;
      if (record.prevHash !== previousHash || hashRecord(data) !== hash) return false;
      previousHash = hash;
    }
    return true;
  }

  merkleRoot(records: readonly AuditRecord[] = this.records): string | null {
    if (records.length === 0) return null;
    let level = records.map(({ hash }) => hash);
    while (level.length > 1) {
      const next: string[] = [];
      for (let index = 0; index < level.length; index += 2) {
        const left = level[index]!;
        const right = level[index + 1] ?? left;
        next.push(sha256(left + right));
      }
      level = next;
    }
    return level[0]!;
  }
}
