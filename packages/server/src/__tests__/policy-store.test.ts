import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { InMemoryPolicyStore, RedisPolicyStore, FilePolicyStore } from "../policy/store.js";
import type { Policy } from "@lumen/types";

describe("InMemoryPolicyStore", () => {
  it("saves, retrieves, and deletes policies", async () => {
    const store = new InMemoryPolicyStore();
    const policy: Policy = {
      id: "p1",
      walletId: "w1",
      rules: [],
      createdAt: new Date(),
    };

    await store.savePolicy(policy);
    const retrieved = await store.getPolicy("w1");
    expect(retrieved).toEqual(policy);

    await store.deletePolicy("w1");
    const afterDelete = await store.getPolicy("w1");
    expect(afterDelete).toBeNull();
  });

  it("tracks daily spend per wallet and asset", async () => {
    const store = new InMemoryPolicyStore();
    const res1 = await store.recordSpend("w1", "2026-09-11", 50, "native");
    expect(res1).toEqual({ dailyTotal: 50, txCount: 1 });

    const res2 = await store.recordSpend("w1", "2026-09-11", 30, "native");
    expect(res2).toEqual({ dailyTotal: 80, txCount: 2 });

    const resUsdc = await store.recordSpend("w1", "2026-09-11", 100, "USDC:G123");
    expect(resUsdc).toEqual({ dailyTotal: 100, txCount: 1 });
  });

  it("tracks velocity within sliding time window", async () => {
    const store = new InMemoryPolicyStore();
    const now = Date.now();
    const count1 = await store.recordVelocity("w1", now, 60000);
    expect(count1).toBe(1);

    const count2 = await store.recordVelocity("w1", now + 1000, 60000);
    expect(count2).toBe(2);

    const count3 = await store.recordVelocity("w1", now + 70000, 60000);
    expect(count3).toBe(1);
  });

  it("creates a version per change with author and timestamp", async () => {
    const store = new InMemoryPolicyStore();
    const policy: Policy = {
      id: "p1",
      walletId: "w1",
      rules: [{ type: "max_operations", maxOperations: 3 }],
      createdAt: new Date(),
    };

    await store.savePolicy(policy, { author: "alice" });
    await store.savePolicy(
      { ...policy, rules: [{ type: "max_operations", maxOperations: 5 }] },
      { author: "bob" },
    );

    const versions = await store.listPolicyVersions("p1");
    expect(versions).toHaveLength(2);
    expect(versions[0].author).toBe("alice");
    expect(versions[1].author).toBe("bob");
    expect(versions[0].rules).toEqual([{ type: "max_operations", maxOperations: 3 }]);
    expect(versions[1].rules).toEqual([{ type: "max_operations", maxOperations: 5 }]);
    expect(versions[0].createdAt).toBeInstanceOf(Date);
    expect(versions[1].createdAt.getTime()).toBeGreaterThanOrEqual(
      versions[0].createdAt.getTime(),
    );
  });

  it("lists versions in chronological order", async () => {
    const store = new InMemoryPolicyStore();
    const policy: Policy = {
      id: "p1",
      walletId: "w1",
      rules: [],
      createdAt: new Date(),
    };

    await store.savePolicy(policy, { author: "a" });
    await store.savePolicy({ ...policy, rules: [{ type: "max_operations", maxOperations: 1 }] }, { author: "b" });
    await store.savePolicy({ ...policy, rules: [{ type: "max_operations", maxOperations: 2 }] }, { author: "c" });

    const versions = await store.listPolicyVersions("p1");
    expect(versions.map((v) => v.author)).toEqual(["a", "b", "c"]);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
  });

  it("rolls back to a target version and appends a new version", async () => {
    const store = new InMemoryPolicyStore();
    const policy: Policy = {
      id: "p1",
      walletId: "w1",
      rules: [{ type: "max_operations", maxOperations: 3 }],
      createdAt: new Date(),
    };

    await store.savePolicy(policy, { author: "alice" });
    await store.savePolicy(
      { ...policy, rules: [{ type: "max_operations", maxOperations: 99 }] },
      { author: "mallory" },
    );

    const versions = await store.listPolicyVersions("p1");
    const target = versions[0];

    const rolledBack = await store.rollbackPolicy("p1", target.version, { author: "admin" });
    expect(rolledBack.rules).toEqual([{ type: "max_operations", maxOperations: 3 }]);

    const current = await store.getPolicy("w1");
    expect(current?.rules).toEqual([{ type: "max_operations", maxOperations: 3 }]);

    const after = await store.listPolicyVersions("p1");
    expect(after).toHaveLength(3);
    expect(after[2].author).toBe("admin");
    expect(after[2].rules).toEqual([{ type: "max_operations", maxOperations: 3 }]);
  });

  it("round-trips a policy through export and import", async () => {
    const store = new InMemoryPolicyStore();
    const policy: Policy = {
      id: "p1",
      walletId: "w1",
      rules: [{ type: "max_operations", maxOperations: 7 }],
      createdAt: new Date(),
    };
    await store.savePolicy(policy, { author: "alice" });

    const exported = await store.exportPolicy("p1");
    expect(exported.rules).toEqual(policy.rules);

    const imported = await store.importPolicy(exported, { author: "importer" });
    expect(imported.rules).toEqual(policy.rules);
    expect(imported.walletId).toBe("w1");
  });
});

describe("RedisPolicyStore", () => {
  it("interacts with Redis client correctly", async () => {
    const mockRedis = {
      get: vi.fn().mockResolvedValue(JSON.stringify({ id: "p1", walletId: "w1", rules: [] })),
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
      incrbyfloat: vi.fn().mockResolvedValue("150.5"),
      incr: vi.fn().mockResolvedValue(2),
      expire: vi.fn().mockResolvedValue(1),
      zadd: vi.fn().mockResolvedValue(1),
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      zcard: vi.fn().mockResolvedValue(3),
    };

    const store = new RedisPolicyStore(mockRedis as any);

    const policy = await store.getPolicy("w1");
    expect(policy?.walletId).toBe("w1");
    expect(mockRedis.get).toHaveBeenCalledWith("lumen:policy:w1");

    const spendRes = await store.recordSpend("w1", "2026-09-11", 50, "native");
    expect(spendRes).toEqual({ dailyTotal: 150.5, txCount: 2 });

    const velRes = await store.recordVelocity("w1", Date.now(), 60000);
    expect(velRes).toBe(3);
  });
});

describe("RedisPolicyStore pub/sub invalidation", () => {
  function createMockRedis() {
    const subscribers = new Map<string, Array<(channel: string, message: string) => void>>();
    const mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue("OK"),
      del: vi.fn().mockResolvedValue(1),
      incrbyfloat: vi.fn().mockResolvedValue("0"),
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      zadd: vi.fn().mockResolvedValue(1),
      zremrangebyscore: vi.fn().mockResolvedValue(0),
      zcard: vi.fn().mockResolvedValue(0),
      subscribe: vi.fn(async (channel: string, handler: (channel: string, message: string) => void) => {
        const handlers = subscribers.get(channel) ?? [];
        handlers.push(handler);
        subscribers.set(channel, handlers);
        return 1;
      }),
      unsubscribe: vi.fn(async (channel: string) => {
        subscribers.delete(channel);
        return 1;
      }),
      publish: vi.fn(async (channel: string, message: string) => {
        const handlers = subscribers.get(channel) ?? [];
        for (const handler of handlers) {
          handler(channel, message);
        }
        return handlers.length;
      }),
    };
    return mockRedis;
  }

  it("invalidates cached policy on a second replica when an update event is published", async () => {
    const mockRedis = createMockRedis();
    const replicaA = new RedisPolicyStore(mockRedis as any);
    const replicaB = new RedisPolicyStore(mockRedis as any);

    await replicaA.subscribeToPolicyUpdates();
    await replicaB.subscribeToPolicyUpdates();
    expect(mockRedis.subscribe).toHaveBeenCalledWith(
      "lumen:policies:updated",
      expect.any(Function),
    );

    // Prime replica B's cache with a stale policy.
    const stalePolicy: Policy = {
      id: "p1",
      walletId: "w1",
      rules: [{ type: "max_operations", maxOperations: 3 }],
      createdAt: new Date(),
    };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(stalePolicy));
    const cached = await replicaB.getPolicy("w1");
    expect(cached?.rules).toEqual(stalePolicy.rules);

    // Admin updates the policy on replica A and publishes the event.
    const updatedPolicy: Policy = {
      id: "p1",
      walletId: "w1",
      rules: [{ type: "max_operations", maxOperations: 10 }],
      createdAt: stalePolicy.createdAt,
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(updatedPolicy));
    await replicaA.savePolicy(updatedPolicy);
    await replicaA.publishPolicyUpdate("w1");

    // Replica B should now read the fresh policy from Redis.
    const refreshed = await replicaB.getPolicy("w1");
    expect(refreshed?.rules).toEqual(updatedPolicy.rules);
  });

  it("propagates invalidation to all replicas within 100ms", async () => {
    const mockRedis = createMockRedis();
    const replicas = [
      new RedisPolicyStore(mockRedis as any),
      new RedisPolicyStore(mockRedis as any),
      new RedisPolicyStore(mockRedis as any),
    ];

    for (const replica of replicas) {
      await replica.subscribeToPolicyUpdates();
    }

    const stalePolicy: Policy = {
      id: "p1",
      walletId: "w1",
      rules: [{ type: "max_operations", maxOperations: 1 }],
      createdAt: new Date(),
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(stalePolicy));
    for (const replica of replicas) {
      await replica.getPolicy("w1");
    }

    const updatedPolicy: Policy = {
      ...stalePolicy,
      rules: [{ type: "max_operations", maxOperations: 5 }],
    };
    mockRedis.get.mockResolvedValue(JSON.stringify(updatedPolicy));

    const start = Date.now();
    await replicas[0].publishPolicyUpdate("w1");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);

    for (const replica of replicas) {
      const policy = await replica.getPolicy("w1");
      expect(policy?.rules).toEqual(updatedPolicy.rules);
    }
  });

  it("stops invalidating after unsubscribe", async () => {
    const mockRedis = createMockRedis();
    const store = new RedisPolicyStore(mockRedis as any);
    await store.subscribeToPolicyUpdates();
    await store.unsubscribeFromPolicyUpdates();
    expect(mockRedis.unsubscribe).toHaveBeenCalledWith("lumen:policies:updated");
  });
});

describe("FilePolicyStore", () => {
  it("persists policies across store instances using a local JSON file", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-policy-test-"));
    const filePath = path.join(tmpDir, "policies.json");

    try {
      const store1 = new FilePolicyStore(filePath);
      const policy: Policy = {
        id: "p1",
        walletId: "w1",
        rules: [{ type: "max_operations", maxOperations: 3 }],
        createdAt: new Date(),
      };

      await store1.savePolicy(policy);
      const retrieved1 = await store1.getPolicy("w1");
      expect(retrieved1).toEqual(policy);

      // Verify file was written and is valid JSON
      expect(fs.existsSync(filePath)).toBe(true);

      // Create a second store instance pointing to same file
      const store2 = new FilePolicyStore(filePath);
      const retrieved2 = await store2.getPolicy("w1");
      expect(retrieved2).toBeDefined();
      expect(retrieved2?.id).toBe("p1");
      expect(retrieved2?.walletId).toBe("w1");
      expect(retrieved2?.rules).toEqual(policy.rules);
      expect(retrieved2?.createdAt.getTime()).toBe(policy.createdAt.getTime());

      // Test deletePolicy persists deletion
      await store2.deletePolicy("w1");
      expect(await store2.getPolicy("w1")).toBeNull();

      // Third store instance confirms deletion was persisted
      const store3 = new FilePolicyStore(filePath);
      expect(await store3.getPolicy("w1")).toBeNull();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("handles recordSpend and recordVelocity in-memory tracking", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-policy-test-"));
    const filePath = path.join(tmpDir, "policies.json");

    try {
      const store = new FilePolicyStore(filePath);
      const res = await store.recordSpend("w1", "2026-09-25", 25, "native");
      expect(res).toEqual({ dailyTotal: 25, txCount: 1 });

      const vel = await store.recordVelocity("w1", Date.now(), 60000);
      expect(vel).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("persists version history and supports rollback across instances", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-policy-test-"));
    const filePath = path.join(tmpDir, "policies.json");

    try {
      const store1 = new FilePolicyStore(filePath);
      const policy: Policy = {
        id: "p1",
        walletId: "w1",
        rules: [{ type: "max_operations", maxOperations: 3 }],
        createdAt: new Date(),
      };

      await store1.savePolicy(policy, { author: "alice" });
      await store1.savePolicy(
        { ...policy, rules: [{ type: "max_operations", maxOperations: 99 }] },
        { author: "mallory" },
      );

      const store2 = new FilePolicyStore(filePath);
      const versions = await store2.listPolicyVersions("p1");
      expect(versions).toHaveLength(2);
      expect(versions.map((v) => v.author)).toEqual(["alice", "mallory"]);

      const rolledBack = await store2.rollbackPolicy("p1", versions[0].version, {
        author: "admin",
      });
      expect(rolledBack.rules).toEqual([{ type: "max_operations", maxOperations: 3 }]);

      const store3 = new FilePolicyStore(filePath);
      const current = await store3.getPolicy("w1");
      expect(current?.rules).toEqual([{ type: "max_operations", maxOperations: 3 }]);

      const after = await store3.listPolicyVersions("p1");
      expect(after).toHaveLength(3);
      expect(after[2].author).toBe("admin");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("round-trips a policy through export and import", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lumen-policy-test-"));
    const filePath = path.join(tmpDir, "policies.json");

    try {
      const store = new FilePolicyStore(filePath);
      const policy: Policy = {
        id: "p1",
        walletId: "w1",
        rules: [{ type: "max_operations", maxOperations: 7 }],
        createdAt: new Date(),
      };
      await store.savePolicy(policy, { author: "alice" });

      const exported = await store.exportPolicy("p1");
      expect(exported.rules).toEqual(policy.rules);

      const imported = await store.importPolicy(exported, { author: "importer" });
      expect(imported.rules).toEqual(policy.rules);
      expect(imported.walletId).toBe("w1");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
