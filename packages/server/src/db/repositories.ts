// packages/server/src/db/repositories.ts
import { PrismaClient } from '@prisma/client';
import type {
  Policy,
  PolicyRule,
  PolicyRuleType,
  Wallet,
  SpendRecord,
  VelocityRecord,
} from '@lumen/types';
import type {
  PolicyStore,
  PolicyVersion,
  WalletRegistry,
  TenantStore,
  Tenant,
  TenantTier,
  WebhookDeliveryStore,
  WebhookDelivery,
  WebhookDeliveryStatus,
} from '../interfaces';

// ---------------------------------------------------------------------------
// Prisma Client Singleton
// ---------------------------------------------------------------------------

let prismaInstance: PrismaClient | null = null;

/**
 * Returns a process-wide singleton PrismaClient instance.
 * Reuses the same client across hot-reloads in development to avoid
 * exhausting the database connection pool.
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.PRISMA_LOG_QUERIES === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
    });
  }
  return prismaInstance;
}

/**
 * Disconnects and clears the singleton. Useful for tests and graceful shutdown.
 */
export async function disconnectPrismaClient(): Promise<void> {
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    prismaInstance = null;
  }
}

// ---------------------------------------------------------------------------
// Mapping helpers: Prisma rows <-> @lumen/types shapes
// ---------------------------------------------------------------------------

interface PrismaPolicyRow {
  id: string;
  walletId: string;
  name: string;
  description: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  rules?: PrismaPolicyRuleRow[];
}

interface PrismaPolicyRuleRow {
  id: string;
  policyId: string;
  type: string;
  config: unknown;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

interface PrismaPolicyVersionRow {
  id: string;
  policyId: string;
  version: number;
  snapshot: unknown;
  author: string | null;
  createdAt: Date;
}

interface PrismaWalletRow {
  id: string;
  address: string;
  label: string | null;
  network: string;
  tags?: string[] | null;
  metadata?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface PrismaSpendTrackingRow {
  id: string;
  policyId: string;
  amount: string;
  asset: string;
  destination: string | null;
  timestamp: Date;
}

interface PrismaVelocityTrackingRow {
  id: string;
  policyId: string;
  amount: string;
  timestamp: Date;
}

interface PrismaTenantRow {
  id: string;
  name: string;
  apiKeyHash: string;
  tier: string;
  monthlyGasQuotaXlm: string;
  monthlyGasUsedXlm: string;
  quotaResetAt: Date;
  allowedDomains: unknown;
  network: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface PrismaWebhookDeliveryRow {
  id: string;
  webhookId: string;
  event: string;
  payload: unknown;
  status: string;
  attempts: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextRetryAt: Date | null;
  deadLetteredAt: Date | null;
  replayCount?: number | null;
  replayedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function mapRuleRowToRule(row: PrismaPolicyRuleRow): PolicyRule {
  return {
    id: row.id,
    type: row.type as PolicyRuleType,
    config: (row.config ?? {}) as Record<string, unknown>,
    order: row.order,
  };
}

function mapPolicyRowToPolicy(row: PrismaPolicyRow): Policy {
  return {
    id: row.id,
    walletId: row.walletId,
    name: row.name,
    description: row.description ?? undefined,
    enabled: row.enabled,
    rules: (row.rules ?? [])
      .slice()
      .sort((a, b) => a.order - b.order)
      .map(mapRuleRowToRule),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPolicyVersionRowToVersion(row: PrismaPolicyVersionRow): PolicyVersion {
  return {
    id: row.id,
    policyId: row.policyId,
    version: row.version,
    snapshot: (row.snapshot ?? {}) as Policy,
    author: row.author ?? undefined,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapWalletRowToWallet(row: PrismaWalletRow): Wallet {
  return {
    id: row.id,
    address: row.address,
    label: row.label ?? undefined,
    network: row.network,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Record<string, unknown>)
        : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapSpendRowToRecord(row: PrismaSpendTrackingRow): SpendRecord {
  return {
    id: row.id,
    policyId: row.policyId,
    amount: row.amount,
    asset: row.asset,
    destination: row.destination ?? undefined,
    timestamp: row.timestamp.toISOString(),
  };
}

function mapVelocityRowToRecord(row: PrismaVelocityTrackingRow): VelocityRecord {
  return {
    id: row.id,
    policyId: row.policyId,
    amount: row.amount,
    timestamp: row.timestamp.toISOString(),
  };
}

function mapTenantRowToTenant(row: PrismaTenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    apiKeyHash: row.apiKeyHash,
    tier: row.tier as TenantTier,
    monthlyGasQuotaXlm: row.monthlyGasQuotaXlm,
    monthlyGasUsedXlm: row.monthlyGasUsedXlm,
    quotaResetAt: row.quotaResetAt.toISOString(),
    allowedDomains: Array.isArray(row.allowedDomains)
      ? (row.allowedDomains as string[])
      : [],
    network: row.network ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapWebhookDeliveryRowToDelivery(row: PrismaWebhookDeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    webhookId: row.webhookId,
    event: row.event,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: row.status as WebhookDeliveryStatus,
    attempts: row.attempts,
    lastStatusCode: row.lastStatusCode ?? undefined,
    lastError: row.lastError ?? undefined,
    nextRetryAt: row.nextRetryAt ? row.nextRetryAt.toISOString() : undefined,
    deadLetteredAt: row.deadLetteredAt ? row.deadLetteredAt.toISOString() : undefined,
    replayCount: row.replayCount ?? 0,
    replayedAt: row.replayedAt ? row.replayedAt.toISOString() : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// PrismaPolicyStore
// ---------------------------------------------------------------------------

export class PrismaPolicyStore implements PolicyStore {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient = getPrismaClient()) {
    this.prisma = prisma;
  }

  async getPolicy(policyId: string): Promise<Policy | null> {
    const row = await this.prisma.policy.findUnique({
      where: { id: policyId },
      include: { rules: true },
    });
    return row ? mapPolicyRowToPolicy(row as unknown as PrismaPolicyRow) : null;
  }

  async listPolicies(walletId: string): Promise<Policy[]> {
    const rows = await this.prisma.policy.findMany({
      where: { walletId },
      include: { rules: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => mapPolicyRowToPolicy(row as unknown as PrismaPolicyRow));
  }

  async savePolicy(policy: Policy): Promise<Policy> {
    const saved = await this.prisma.$transaction(async (tx) => {
      const policyRow = await tx.policy.upsert({
        where: { id: policy.id },
        create: {
          id: policy.id,
          walletId: policy.walletId,
          name: policy.name,
          description: policy.description ?? null,
          enabled: policy.enabled,
        },
        update: {
          walletId: policy.walletId,
          name: policy.name,
          description: policy.description ?? null,
          enabled: policy.enabled,
        },
      });

      // Replace rules atomically to reflect the new policy definition.
      await tx.policyRule.deleteMany({ where: { policyId: policy.id } });

      if (policy.rules.length > 0) {
        await tx.policyRule.createMany({
          data: policy.rules.map((rule, index) => ({
            id: rule.id,
            policyId: policy.id,
            type: rule.type,
            config: (rule.config ?? {}) as object,
            order: rule.order ?? index,
          })),
        });
      }

      const persisted = await tx.policy.findUnique({
        where: { id: policyRow.id },
        include: { rules: true },
      });

      if (!persisted) {
        throw new Error(`Failed to persist policy ${policy.id}`);
      }

      // Capture an immutable snapshot for every change so the policy can be
      // audited and rolled back later.
      const mapped = mapPolicyRowToPolicy(persisted as unknown as PrismaPolicyRow);
      await this.writeVersionRow(tx, mapped, policy.updatedBy);

      return persisted;
    });

    if (!saved) {
      throw new Error(`Failed to persist policy ${policy.id}`);
    }
    return mapPolicyRowToPolicy(saved as unknown as PrismaPolicyRow);
  }

  async savePolicyVersion(policy: Policy, author?: string): Promise<PolicyVersion> {
    const row = await this.prisma.$transaction(async (tx) => {
      const persisted = await tx.policy.findUnique({
        where: { id: policy.id },
        include: { rules: true },
      });
      if (!persisted) {
        throw new Error(`Policy ${policy.id} not found`);
      }
      const mapped = mapPolicyRowToPolicy(persisted as unknown as PrismaPolicyRow);
      return this.writeVersionRow(tx, mapped, author);
    });
    return mapPolicyVersionRowToVersion(row as unknown as PrismaPolicyVersionRow);
  }

  async listPolicyVersions(policyId: string): Promise<PolicyVersion[]> {
    const rows = await this.prisma.policyVersion.findMany({
      where: { policyId },
      orderBy: { version: 'desc' },
    });
    return rows.map((row) =>
      mapPolicyVersionRowToVersion(row as unknown as PrismaPolicyVersionRow),
    );
  }

  async getPolicyVersion(policyId: string, version: number): Promise<PolicyVersion | null> {
    const row = await this.prisma.policyVersion.findUnique({
      where: { policyId_version: { policyId, version } },
    });
    return row ? mapPolicyVersionRowToVersion(row as unknown as PrismaPolicyVersionRow) : null;
  }

  async rollbackPolicy(
    policyId: string,
    targetVersion: number,
    author?: string,
  ): Promise<Policy> {
    const target = await this.getPolicyVersion(policyId, targetVersion);
    if (!target) {
      throw new Error(`Policy ${policyId} version ${targetVersion} not found`);
    }

    const snapshot = target.snapshot;
    const restored: Policy = {
      ...snapshot,
      id: policyId,
      updatedAt: new Date().toISOString(),
      updatedBy: author ?? snapshot.updatedBy,
    };

    // savePolicy writes the restored definition and records a new version row,
    // so the rollback itself is part of the audit history.
    return this.savePolicy(restored);
  }

  /**
   * Inserts the next sequential version row for a policy snapshot.
   */
  private async writeVersionRow(
    tx: Pick<PrismaClient, 'policyVersion'>,
    policy: Policy,
    author?: string,
  ): Promise<unknown> {
    const latest = await tx.policyVersion.findFirst({
      where: { policyId: policy.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    return tx.policyVersion.create({
      data: {
        policyId: policy.id,
        version: nextVersion,
        snapshot: policy as unknown as object,
        author: author ?? null,
      },
    });
  }

  async deletePolicy(policyId: string): Promise<boolean> {
    try {
      await this.prisma.$transaction([
        this.prisma.policyVersion.deleteMany({ where: { policyId } }),
        this.prisma.policy.delete({ where: { id: policyId } }),
      ]);
      return true;
    } catch (err: unknown) {
      if (isNotFoundError(err)) {
        return false;
      }
      throw err;
    }
  }

  async recordSpend(
    policyId: string,
    amount: string,
    asset: string,
    destination?: string,
  ): Promise<SpendRecord> {
    const row = await this.prisma.spendTracking.create({
      data: {
        policyId,
        amount,
        asset,
        destination: destination ?? null,
      },
    });
    return mapSpendRowToRecord(row as unknown as PrismaSpendTrackingRow);
  }

  async recordVelocity(policyId: string, amount: string): Promise<VelocityRecord> {
    const row = await this.prisma.velocityTracking.create({
      data: {
        policyId,
        amount,
      },
    });
    return mapVelocityRowToRecord(row as unknown as PrismaVelocityTrackingRow);
  }

  /**
   * Returns spend records for a policy within the given window.
   * Used by the policy engine to evaluate rolling spend limits.
   */
  async getSpendRecords(policyId: string, since: Date): Promise<SpendRecord[]> {
    const rows = await this.prisma.spendTracking.findMany({
      where: { policyId, timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
    });
    return rows.map((row) => mapSpendRowToRecord(row as unknown as PrismaSpendTrackingRow));
  }

  /**
   * Returns velocity records for a policy within the given window.
   * Used by the policy engine to evaluate transaction frequency limits.
   */
  async getVelocityRecords(policyId: string, since: Date): Promise<VelocityRecord[]> {
    const rows = await this.prisma.velocityTracking.findMany({
      where: { policyId, timestamp: { gte: since } },
      orderBy: { timestamp: 'asc' },
    });
    return rows.map((row) => mapVelocityRowToRecord(row as unknown as PrismaVelocityTrackingRow));
  }
}

// ---------------------------------------------------------------------------
// PrismaWalletRegistry
// ---------------------------------------------------------------------------

export class PrismaWalletRegistry implements WalletRegistry {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient = getPrismaClient()) {
    this.prisma = prisma;
  }

  async getWallet(walletId: string): Promise<Wallet | null> {
    const row = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    return row ? mapWalletRowToWallet(row as unknown as PrismaWalletRow) : null;
  }

  async getWalletByAddress(address: string, network?: string): Promise<Wallet | null> {
    // Wallet addresses are only unique per network, so scope the lookup by
    // network when one is provided to avoid mixing testnet/mainnet wallets.
    const row = network
      ? await this.prisma.wallet.findFirst({ where: { address, network } })
      : await this.prisma.wallet.findUnique({ where: { address } });
    return row ? mapWalletRowToWallet(row as unknown as PrismaWalletRow) : null;
  }

  async listWallets(network?: string): Promise<Wallet[]> {
    const rows = await this.prisma.wallet.findMany({
      where: network ? { network } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => mapWalletRowToWallet(row as unknown as PrismaWalletRow));
  }

  /**
   * Updates operator-managed wallet metadata (label, tags, metadata).
   * Throws if the wallet does not exist.
   */
  async updateWalletMetadata(
    address: string,
    patch: { label?: string | null; tags?: string[]; metadata?: Record<string, unknown> | null },
  ): Promise<Wallet> {
    const existing = await this.prisma.wallet.findUnique({ where: { address } });
    if (!existing) {
      throw new Error(`Wallet not found: ${address}`);
    }

    const row = await this.prisma.wallet.update({
      where: { address },
      data: {
        ...(patch.label !== undefined ? { label: patch.label ?? null } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.metadata !== undefined
          ? { metadata: patch.metadata === null ? null : (patch.metadata as object) }
          : {}),
      },
    });
    return mapWalletRowToWallet(row as unknown as PrismaWalletRow);
  }

  async registerWallet(wallet: Wallet): Promise<Wallet> {
    const row = await this.prisma.wallet.upsert({
      where: { id: wallet.id },
      create: {
        id: wallet.id,
        address: wallet.address,
        label: wallet.label ?? null,
        network: wallet.network,
      },
      update: {
        address: wallet.address,
        label: wallet.label ?? null,
        network: wallet.network,
      },
    });
    return mapWalletRowToWallet(row as unknown as PrismaWalletRow);
  }

  async removeWallet(walletId: string): Promise<boolean> {
    try {
      await this.prisma.wallet.delete({ where: { id: walletId } });
      return true;
    } catch (err: unknown) {
      if (isNotFoundError(err)) {
        return false;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// PrismaTenantStore
// ---------------------------------------------------------------------------

export class PrismaTenantStore implements TenantStore {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient = getPrismaClient()) {
    this.prisma = prisma;
  }

  async createTenant(tenant: Tenant): Promise<Tenant> {
    const row = await this.prisma.tenant.upsert({
      where: { id: tenant.id },
      create: {
        id: tenant.id,
        name: tenant.name,
        apiKeyHash: tenant.apiKeyHash,
        tier: tenant.tier,
        monthlyGasQuotaXlm: tenant.monthlyGasQuotaXlm,
        monthlyGasUsedXlm: tenant.monthlyGasUsedXlm ?? '0',
        quotaResetAt: new Date(tenant.quotaResetAt),
        allowedDomains: tenant.allowedDomains ?? [],
        network: tenant.network ?? null,
      },
      update: {
        name: tenant.name,
        apiKeyHash: tenant.apiKeyHash,
        tier: tenant.tier,
        monthlyGasQuotaXlm: tenant.monthlyGasQuotaXlm,
        allowedDomains: tenant.allowedDomains ?? [],
        network: tenant.network ?? null,
      },
    });
    return mapTenantRowToTenant(row as unknown as PrismaTenantRow);
  }

  async getTenant(tenantId: string): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    return row ? mapTenantRowToTenant(row as unknown as PrismaTenantRow) : null;
  }

  async getTenantByApiKeyHash(apiKeyHash: string): Promise<Tenant | null> {
    const row = await this.prisma.tenant.findUnique({ where: { apiKeyHash } });
    return row ? mapTenantRowToTenant(row as unknown as PrismaTenantRow) : null;
  }

  async listTenants(network?: string): Promise<Tenant[]> {
    const rows = await this.prisma.tenant.findMany({
      where: network ? { network } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => mapTenantRowToTenant(row as unknown as PrismaTenantRow));
  }

  async addGasUsage(tenantId: string, amountXlm: string): Promise<Tenant> {
    const row = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { monthlyGasUsedXlm: { increment: amountXlm } },
    });
    return mapTenantRowToTenant(row as unknown as PrismaTenantRow);
  }

  async resetQuota(tenantId: string, nextResetAt: Date): Promise<Tenant> {
    const row = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: { monthlyGasUsedXlm: '0', quotaResetAt: nextResetAt },
    });
    return mapTenantRowToTenant(row as unknown as PrismaTenantRow);
  }

  async deleteTenant(tenantId: string): Promise<boolean> {
    try {
      await this.prisma.tenant.delete({ where: { id: tenantId } });
      return true;
    } catch (err: unknown) {
      if (isNotFoundError(err)) {
        return false;
      }
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// PrismaWebhookDeliveryStore
// ---------------------------------------------------------------------------

export class PrismaWebhookDeliveryStore implements WebhookDeliveryStore {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient = getPrismaClient()) {
    this.prisma = prisma;
  }

  async createDelivery(
    delivery: Omit<WebhookDelivery, 'createdAt' | 'updatedAt'>,
  ): Promise<WebhookDelivery> {
    const row = await this.prisma.webhookDelivery.create({
      data: {
        id: delivery.id,
        webhookId: delivery.webhookId,
        event: delivery.event,
        payload: (delivery.payload ?? {}) as object,
        status: delivery.status,
        attempts: delivery.attempts ?? 0,
        lastStatusCode: delivery.lastStatusCode ?? null,
        lastError: delivery.lastError ?? null,
        nextRetryAt: delivery.nextRetryAt ? new Date(delivery.nextRetryAt) : null,
        deadLetteredAt: delivery.deadLetteredAt ? new Date(delivery.deadLetteredAt) : null,
      },
    });
    return mapWebhookDeliveryRowToDelivery(row as unknown as PrismaWebhookDeliveryRow);
  }

  async getDelivery(deliveryId: string): Promise<WebhookDelivery | null> {
    const row = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    return row ? mapWebhookDeliveryRowToDelivery(row as unknown as PrismaWebhookDeliveryRow) : null;
  }

  async listDeliveries(webhookId: string): Promise<WebhookDelivery[]> {
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { webhookId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) =>
      mapWebhookDeliveryRowToDelivery(row as unknown as PrismaWebhookDeliveryRow),
    );
  }

  async updateDelivery(
    deliveryId: string,
    patch: Partial<WebhookDelivery>,
  ): Promise<WebhookDelivery> {
    const row = await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
        ...(patch.lastStatusCode !== undefined
          ? { lastStatusCode: patch.lastStatusCode ?? null }
          : {}),
        ...(patch.lastError !== undefined ? { lastError: patch.lastError ?? null } : {}),
        ...(patch.nextRetryAt !== undefined
          ? { nextRetryAt: patch.nextRetryAt ? new Date(patch.nextRetryAt) : null }
          : {}),
        ...(patch.deadLetteredAt !== undefined
          ? { deadLetteredAt: patch.deadLetteredAt ? new Date(patch.deadLetteredAt) : null }
          : {}),
      },
    });
    return mapWebhookDeliveryRowToDelivery(row as unknown as PrismaWebhookDeliveryRow);
  }

  async markDeadLettered(
    deliveryId: string,
    error: string,
    deadLetteredAt: Date = new Date(),
  ): Promise<WebhookDelivery> {
    const row = await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        status: 'dead_lettered',
        lastError: error,
        nextRetryAt: null,
        deadLetteredAt,
      },
    });
    return mapWebhookDeliveryRowToDelivery(row as unknown as PrismaWebhookDeliveryRow);
  }

  /**
   * Lists dead-lettered deliveries, newest first, with pagination.
   */
  async listDeadLettered(limit: number, offset: number): Promise<WebhookDelivery[]> {
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { status: 'dead_lettered' },
      orderBy: { deadLetteredAt: 'desc' },
      take: limit,
      skip: offset,
    });
    return rows.map((row) =>
      mapWebhookDeliveryRowToDelivery(row as unknown as PrismaWebhookDeliveryRow),
    );
  }

  /**
   * Returns a single dead-lettered delivery, or null if it is not dead-lettered.
   */
  async getDeadLettered(deliveryId: string): Promise<WebhookDelivery | null> {
    const row = await this.prisma.webhookDelivery.findUnique({ where: { id: deliveryId } });
    if (!row || row.status !== 'dead_lettered') {
      return null;
    }
    return mapWebhookDeliveryRowToDelivery(row as unknown as PrismaWebhookDeliveryRow);
  }

  /**
   * Records a replay attempt: bumps replayCount and sets replayedAt.
   */
  async markReplayed(deliveryId: string, replayedAt: Date = new Date()): Promise<WebhookDelivery> {
    const row = await this.prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        replayCount: { increment: 1 },
        replayedAt,
      },
    });
    return mapWebhookDeliveryRowToDelivery(row as unknown as PrismaWebhookDeliveryRow);
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}
```

```typescript
// packages/server/src/__tests__/prisma-policy-store.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  PrismaPolicyStore,
  PrismaWalletRegistry,
  getPrismaClient,
  disconnectPrismaClient,
} from '../db/repositories';
import { PolicyEngine } from '../policy/engine';
import type { Policy, Wallet } from '@lumen/types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function makeWallet(id: string): Wallet {
  return {
    id,
    address: `G${id.toUpperCase().padEnd(55, 'A')}`,
    label: `wallet-${id}`,
    network: 'testnet',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makePolicy(id: string, walletId: string, overrides: Partial<Policy> = {}): Policy {
  return {
    id,
    walletId,
    name: `policy-${id}`,
    description: 'integration test policy',
    enabled: true,
    rules: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describeIfDb('PrismaPolicyStore (integration)', () => {
  const prisma = getPrismaClient();
  const store = new PrismaPolicyStore(prisma);
  const registry = new PrismaWalletRegistry(prisma);

  const walletId = 'test-wallet-1';
  const policyId = 'test-policy-1';

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.spendTracking.deleteMany({ where: { policyId } });
    await prisma.velocityTracking.deleteMany({ where: { policyId } });
    await prisma.policyRule.deleteMany({ where: { policyId } });
    await prisma.policy.deleteMany({ where: { id: policyId } });
    await prisma.wallet.deleteMany({ where: { id: walletId } });
    await disconnectPrismaClient();
  });

  beforeEach(async () => {
    await prisma.spendTracking.deleteMany({ where: { policyId } });
    await prisma.velocityTracking.deleteMany({ where: { policyId } });
    await prisma.policyRule.deleteMany({ where: { policyId } });
    await prisma.policy.deleteMany({ where: { id: policyId } });
    await prisma.wallet.deleteMany({ where: { id: walletId } });
  });

  it('registers and retrieves wallets', async () => {
    const wallet = makeWallet(walletId);
    const saved = await registry.registerWallet(wallet);
    expect(saved.id).toBe(walletId);
    expect(saved.address).toBe(wallet.address);

    const fetched = await registry.getWallet(walletId);
    expect(fetched).not.toBeNull();
    expect(fetched?.address).toBe(wallet.address);

    const byAddress = await registry.getWalletByAddress(wallet.address);
    expect(byAddress?.id).toBe(walletId);

    const list = await registry.listWallets();
    expect(list.some((w) => w.id === walletId)).toBe(true);

    const removed = await registry.removeWallet(walletId);
    expect(removed).toBe(true);
    expect(await registry.getWallet(walletId)).toBeNull();
  });

  it('saves, retrieves, lists and deletes policies with rules', async () => {
    await registry.registerWallet(makeWallet(walletId));

    const policy = makePolicy(policyId, walletId, {
      rules: [
        { id: 'rule-1', type: 'spend_limit', config: { limit: '100', asset: 'XLM' }, order: 0 },
        { id: 'rule-2', type: 'velocity', config: { maxTx: 5, windowMs: 60000 }, order: 1 },
      ],
    });

    const saved = await store.savePolicy(policy);
    expect(saved.id).toBe(policyId);
    expect(saved.rules).toHaveLength(2);
    expect(saved.rules[0].type).toBe('spend_limit');

    const fetched = await store.getPolicy(policyId);
    expect(fetched).not.toBeNull();
    expect(fetched?.rules).toHaveLength(2);

    const list = await store.listPolicies(walletId);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(policyId);

    // Update: replace rules
    const updated = await store.savePolicy({
      ...policy,
      rules: [{ id: 'rule-3', type: 'allowlist', config: { addresses: ['GABC'] }, order: 0 }],
    });
    expect(updated.rules).toHaveLength(1);
    expect(updated.rules[0].type).toBe('allowlist');

    const deleted = await store.deletePolicy(policyId);
    expect(deleted).toBe(true);
    expect(await store.getPolicy(policyId)).toBeNull();

    const deletedAgain = await store.deletePolicy(policyId);
    expect(deletedAgain).toBe(false);
  });

  it('records spend and velocity entries', async () => {
    await registry.registerWallet(makeWallet(walletId));
    await store.savePolicy(makePolicy(policyId, walletId));

    const spend = await store.recordSpend(policyId, '25', 'XLM', 'GDEST');
    expect(spend.policyId).toBe(policyId);
    expect(spend.amount).toBe('25');
    expect(spend.asset).toBe('XLM');
    expect(spend.destination).toBe('GDEST');

    const velocity = await store.recordVelocity(policyId, '10');
    expect(velocity.policyId).toBe(policyId);
    expect(velocity.amount).toBe('10');

    const since = new Date(Date.now() - 60_000);
    const spends = await store.getSpendRecords(policyId, since);
    expect(spends).toHaveLength(1);

    const velocities = await store.getVelocityRecords(policyId, since);
    expect(velocities).toHaveLength(1);
  });

  it('runs the PolicyEngine against the Prisma-backed store', async () => {
    await registry.registerWallet(makeWallet(walletId));

    const policy = makePolicy(policyId, walletId, {
      rules: [
        {
          id: 'rule-spend',
          type: 'spend_limit',
          config: { limit: '100', asset: 'XLM', windowMs: 86_400_000 },
          order: 0,
        },
      ],
    });
    await store.savePolicy(policy);

    const engine = new PolicyEngine(store);

    const first = await engine.evaluate({
      policyId,
      walletId,
      amount: '40',
      asset: 'XLM',
      destination: 'GDEST',
    });
    expect(first.allowed).toBe(true);

    const second = await engine.evaluate({
      policyId,
      walletId,
      amount: '40',
      asset: 'XLM',
      destination: 'GDEST',
    });
    expect(second.allowed).toBe(true);

    const third = await engine.evaluate({
      policyId,
      walletId,
      amount: '40',
      asset: 'XLM',
      destination: 'GDEST',
    });
    expect(third.allowed).toBe(false);
  });
});