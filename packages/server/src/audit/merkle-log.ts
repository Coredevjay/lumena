import { createHash } from "node:crypto";

export const MAX_EXPLAIN_TRACE_ENTRIES = 50;
export const TRUNCATION_RULE_ID = "__truncated__";

export interface ExplainTraceEntry {
  ruleId: string;
  inputs: Readonly<Record<string, unknown>>;
  outcome: "approved" | "rejected" | "skipped";
  reason?: string;
}

export interface AuditRecord {
  prevHash: string;
  timestamp: string;
  txHash: string;
  walletAddress: string;
  decision: "approved" | "rejected";
  rulesEvaluated: readonly string[];
  explainTrace?: readonly ExplainTraceEntry[];
  hash: string;
}

export interface AuditDecision {
  timestamp?: string;
  txHash: string;
  walletAddress: string;
  decision: "approved" | "rejected";
  rulesEvaluated: string[];
  explainTrace?: readonly ExplainTraceEntry[];
}

export interface ExplainTraceOptions {
  redactAmounts?: boolean;
}

const AMOUNT_KEY_PATTERN = /amount/i;
const REDACTED_AMOUNT = "[redacted]";

function redactInputs(inputs: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(inputs)) {
    redacted[key] = AMOUNT_KEY_PATTERN.test(key) ? REDACTED_AMOUNT : value;
  }
  return redacted;
}

function normalizeTraceEntry(
  entry: ExplainTraceEntry,
  options: ExplainTraceOptions,
): ExplainTraceEntry {
  const normalized: ExplainTraceEntry = {
    ruleId: entry.ruleId,
    inputs: Object.freeze(options.redactAmounts ? redactInputs(entry.inputs) : { ...entry.inputs }),
    outcome: entry.outcome,
  };
  if (entry.reason !== undefined) normalized.reason = entry.reason;
  return Object.freeze(normalized);
}

export function buildExplainTrace(
  trace: readonly ExplainTraceEntry[] | undefined,
  options: ExplainTraceOptions = {},
): readonly ExplainTraceEntry[] | undefined {
  if (!trace) return undefined;
  const normalized = trace.map((entry) => normalizeTraceEntry(entry, options));
  if (normalized.length <= MAX_EXPLAIN_TRACE_ENTRIES) return Object.freeze(normalized);
  const kept = normalized.slice(0, MAX_EXPLAIN_TRACE_ENTRIES - 1);
  const truncatedCount = normalized.length - kept.length;
  kept.push(
    Object.freeze({
      ruleId: TRUNCATION_RULE_ID,
      inputs: Object.freeze({ truncatedCount }),
      outcome: "skipped" as const,
      reason: `Trace truncated to ${MAX_EXPLAIN_TRACE_ENTRIES} entries`,
    }),
  );
  return Object.freeze(kept);
}

function isValidTraceEntry(value: unknown): value is ExplainTraceEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.ruleId === "string" &&
    !!entry.inputs &&
    typeof entry.inputs === "object" &&
    !Array.isArray(entry.inputs) &&
    (entry.outcome === "approved" || entry.outcome === "rejected" || entry.outcome === "skipped") &&
    (entry.reason === undefined || typeof entry.reason === "string")
  );
}

export interface AuditLogStorage {
  load(): Promise<AuditRecord[]>;
  append(record: AuditRecord): Promise<boolean>;
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
    (record.explainTrace !== undefined &&
      (!Array.isArray(record.explainTrace) ||
        record.explainTrace.length > MAX_EXPLAIN_TRACE_ENTRIES ||
        !record.explainTrace.every(isValidTraceEntry))) ||
    typeof record.hash !== "string"
  ) {
    throw new Error("Stored audit record has an invalid shape");
  }
  const parsed: {
    prevHash: string;
    timestamp: string;
    txHash: string;
    walletAddress: string;
    decision: "approved" | "rejected";
    rulesEvaluated: readonly string[];
    explainTrace?: readonly ExplainTraceEntry[];
    hash: string;
  } = {
    prevHash: record.prevHash,
    timestamp: record.timestamp,
    txHash: record.txHash,
    walletAddress: record.walletAddress,
    decision: record.decision,
    rulesEvaluated: Object.freeze([...record.rulesEvaluated]),
    hash: record.hash,
  };
  if (record.explainTrace !== undefined) {
    parsed.explainTrace = Object.freeze(
      (record.explainTrace as ExplainTraceEntry[]).map((entry) =>
        Object.freeze({
          ruleId: entry.ruleId,
          inputs: Object.freeze({ ...entry.inputs }),
          outcome: entry.outcome,
          ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
        }),
      ),
    );
  }
  return Object.freeze(parsed);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) sorted[key] = canonicalize(source[key]);
    }
    return sorted;
  }
  return value;
}

function hashRecord(record: Omit<AuditRecord, "hash">): string {
  return sha256(JSON.stringify(canonicalize(record)));
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

  append(decision: AuditDecision, options: ExplainTraceOptions = {}): Promise<AuditRecord> {
    const append = this.writeQueue.then(async () => {
      await this.loading;
      for (let attempt = 0; attempt < 10; attempt++) {
        const explainTrace = buildExplainTrace(decision.explainTrace, options);
        const data: Omit<AuditRecord, "hash"> = {
          prevHash: this.records.at(-1)?.hash ?? "",
          timestamp: decision.timestamp ?? new Date().toISOString(),
          txHash: decision.txHash,
          walletAddress: decision.walletAddress,
          decision: decision.decision,
          rulesEvaluated: Object.freeze([...decision.rulesEvaluated]),
          ...(explainTrace !== undefined ? { explainTrace } : {}),
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
