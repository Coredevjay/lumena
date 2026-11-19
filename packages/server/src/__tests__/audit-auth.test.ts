import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import { createServer, type ServerResult } from "../server.js";
import { EnvSigner } from "../signers/EnvSigner.js";
import { WebSocket } from "ws";
import crypto from "node:crypto";
import http from "node:http";

function signJwt(payload: object, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

describe("Audit WebSocket Authentication", () => {
  let serverResult: ServerResult;
  let wsUrl: string;
  const apiKey = "test-secret-api-key-123";
  const jwtSecret = "test-jwt-secret-audit";

  beforeAll(async () => {
    const cosignerKeypair = Keypair.random();
    const feePayerKeypair = Keypair.random();
    process.env.JWT_SECRET = jwtSecret;
    serverResult = createServer({
      port: 0,
      network: "local",
      cosignerSigner: new EnvSigner(cosignerKeypair.secret()),
      feePayerSigner: new EnvSigner(feePayerKeypair.secret()),
      apiKey,
      rbac: {},
    });
    await new Promise<void>((resolve) => serverResult.server.once("listening", resolve));
    const address = serverResult.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind to TCP port");
    }
    wsUrl = `ws://127.0.0.1:${address.port}/audit/stream`;
  });

  afterAll(async () => {
    serverResult.sponsorMonitorService.stop();
    delete process.env.JWT_SECRET;
    await new Promise<void>((resolve) => serverResult.server.close(() => resolve()));
  });

  it("rejects unauthenticated WebSocket connection with 401 when apiKey is set", async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      ws.on("open", () => {
        ws.close();
        reject(new Error("Should not have connected without authentication"));
      });
      ws.on("error", (err) => {
        expect(err.message).toContain("401");
        resolve();
      });
    });
  });

  it("connects successfully with valid Authorization Bearer API key token", async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });
      ws.on("open", () => {
        ws.close();
        resolve();
      });
      ws.on("error", (err) => {
        reject(err);
      });
    });
  });

  it("connects successfully with valid ?token= query parameter API key", async () => {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}?token=${apiKey}`);
      ws.on("open", () => {
        ws.close();
        resolve();
      });
      ws.on("error", (err) => {
        reject(err);
      });
    });
  });

  it("connects successfully with valid JWT token having auditor role (audit:read permission)", async () => {
    const cosignerKeypair = Keypair.random();
    const feePayerKeypair = Keypair.random();
    const rbacServer = createServer({
      port: 0,
      network: "local",
      cosignerSigner: new EnvSigner(cosignerKeypair.secret()),
      feePayerSigner: new EnvSigner(feePayerKeypair.secret()),
      rbac: {},
    });
    await new Promise<void>((resolve) => rbacServer.server.once("listening", resolve));
    const address = rbacServer.server.address() as import("node:net").AddressInfo;
    const rbacWsUrl = `ws://127.0.0.1:${address.port}/audit/stream`;

    const token = signJwt(
      { sub: "auditor-1", role: "auditor", exp: Math.floor(Date.now() / 1000) + 3600 },
      jwtSecret,
    );

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${rbacWsUrl}?token=${token}`);
      ws.on("open", () => {
        ws.close();
        rbacServer.server.close(() => resolve());
      });
      ws.on("error", (err) => {
        rbacServer.server.close(() => reject(err));
      });
    });
  });

  it("rejects unauthenticated request on RBAC-enabled server", async () => {
    const cosignerKeypair = Keypair.random();
    const feePayerKeypair = Keypair.random();
    const rbacServer = createServer({
      port: 0,
      network: "local",
      cosignerSigner: new EnvSigner(cosignerKeypair.secret()),
      feePayerSigner: new EnvSigner(feePayerKeypair.secret()),
      rbac: {},
    });
    await new Promise<void>((resolve) => rbacServer.server.once("listening", resolve));
    const address = rbacServer.server.address() as import("node:net").AddressInfo;
    const rbacWsUrl = `ws://127.0.0.1:${address.port}/audit/stream`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(rbacWsUrl);
      ws.on("open", () => {
        ws.close();
        rbacServer.server.close(() => reject(new Error("Should not have connected")));
      });
      ws.on("error", (err) => {
        expect(err.message).toMatch(/401|403/);
        rbacServer.server.close(() => resolve());
      });
    });
  });
});

interface ExportResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function httpGet(
  port: number,
  path: string,
  headers: Record<string, string> = {},
): Promise<ExportResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function parseJsonl(body: string): Record<string, unknown>[] {
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function parseCsv(body: string): { header: string[]; rows: string[][] } {
  const lines = body.split("\n").filter((line) => line.trim().length > 0);
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  };
  const [headerLine, ...rowLines] = lines;
  return {
    header: parseLine(headerLine ?? ""),
    rows: rowLines.map(parseLine),
  };
}

describe("Audit export endpoint", () => {
  let serverResult: ServerResult;
  let port: number;
  const apiKey = "test-secret-api-key-export";
  const authHeaders = { Authorization: `Bearer ${apiKey}` };

  beforeAll(async () => {
    const cosignerKeypair = Keypair.random();
    const feePayerKeypair = Keypair.random();
    serverResult = createServer({
      port: 0,
      network: "local",
      cosignerSigner: new EnvSigner(cosignerKeypair.secret()),
      feePayerSigner: new EnvSigner(feePayerKeypair.secret()),
      apiKey,
      rbac: {},
    });
    await new Promise<void>((resolve) => serverResult.server.once("listening", resolve));
    const address = serverResult.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind to TCP port");
    }
    port = address.port;
  });

  afterAll(async () => {
    serverResult.sponsorMonitorService.stop();
    await new Promise<void>((resolve) => serverResult.server.close(() => resolve()));
  });

  it("requires authentication", async () => {
    const res = await httpGet(port, "/audit/export?format=jsonl");
    expect(res.status).toBe(401);
  });

  it("streams JSONL export with one JSON object per line", async () => {
    const res = await httpGet(port, "/audit/export?format=jsonl", authHeaders);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/x-ndjson/);
    const lines = res.body.split("\n").filter((line) => line.trim().length > 0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  it("streams CSV export with a header row and matching column count", async () => {
    const res = await httpGet(port, "/audit/export?format=csv", authHeaders);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    const { header, rows } = parseCsv(res.body);
    expect(header.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.length).toBe(header.length);
    }
  });

  it("filters exported entries by wallet", async () => {
    const wallet = Keypair.random().publicKey();
    const res = await httpGet(
      port,
      `/audit/export?format=jsonl&wallet=${encodeURIComponent(wallet)}`,
      authHeaders,
    );
    expect(res.status).toBe(200);
    const entries = parseJsonl(res.body);
    for (const entry of entries) {
      expect(entry.wallet).toBe(wallet);
    }
  });

  it("filters exported entries by date range", async () => {
    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const to = new Date().toISOString();
    const res = await httpGet(
      port,
      `/audit/export?format=jsonl&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      authHeaders,
    );
    expect(res.status).toBe(200);
    const entries = parseJsonl(res.body);
    for (const entry of entries) {
      const ts = new Date(String(entry.timestamp)).getTime();
      expect(ts).toBeGreaterThanOrEqual(new Date(from).getTime());
      expect(ts).toBeLessThanOrEqual(new Date(to).getTime());
    }
  });

  it("pages through entries without buffering the full export in memory", async () => {
    const res = await httpGet(
      port,
      "/audit/export?format=jsonl&pageSize=10",
      authHeaders,
    );
    expect(res.status).toBe(200);
    // Streaming responses must not advertise a fixed content-length that
    // would require the server to buffer the entire export.
    expect(res.headers["content-length"]).toBeUndefined();
    expect(res.headers["transfer-encoding"]).toBe("chunked");
    const entries = parseJsonl(res.body);
    expect(entries.length).toBeLessThanOrEqual(10);
  });

  it("returns a signed manifest whose Merkle root verifies offline", async () => {
    const res = await httpGet(port, "/audit/export?format=jsonl", authHeaders);
    expect(res.status).toBe(200);

    const manifestHeader = res.headers["x-audit-manifest"];
    expect(manifestHeader).toBeDefined();
    const manifest = JSON.parse(String(manifestHeader)) as {
      merkleRoot: string;
      signature: string;
      publicKey: string;
      count: number;
      algorithm: string;
    };
    expect(manifest.merkleRoot).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.algorithm).toBe("ed25519");
    expect(manifest.signature).toBeTruthy();
    expect(manifest.publicKey).toBeTruthy();

    // Recompute the Merkle root from the exported entries offline.
    const entries = parseJsonl(res.body);
    expect(entries.length).toBe(manifest.count);

    const leafHashes = entries.map((entry) =>
      crypto.createHash("sha256").update(JSON.stringify(entry)).digest(),
    );
    let level = leafHashes;
    if (level.length === 0) {
      level = [crypto.createHash("sha256").update("").digest()];
    }
    while (level.length > 1) {
      const next: Buffer[] = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = i + 1 < level.length ? level[i + 1] : left;
        next.push(crypto.createHash("sha256").update(Buffer.concat([left, right])).digest());
      }
      level = next;
    }
    const computedRoot = level[0].toString("hex");
    expect(computedRoot).toBe(manifest.merkleRoot);

    // Verify the manifest signature offline using the embedded public key.
    const manifestPayload = JSON.stringify({
      merkleRoot: manifest.merkleRoot,
      count: manifest.count,
      algorithm: manifest.algorithm,
    });
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(manifest.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    const valid = crypto.verify(
      null,
      Buffer.from(manifestPayload),
      publicKey,
      Buffer.from(manifest.signature, "base64"),
    );
    expect(valid).toBe(true);
  });
});
