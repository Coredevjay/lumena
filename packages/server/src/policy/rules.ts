import type {
  Policy,
  SpendLimit,
  VelocityRule,
  AllowlistRule,
  BlocklistRule,
  AssetAllowlistRule,
  TimeBoundsRule,
  MaxOperationsRule,
} from "@lumen/types";

export function createSpendLimitPolicy(
  walletId: string,
  asset: string,
  maxPerTx: string,
  maxDaily: string,
): Policy {
  const rule: SpendLimit = { type: "spend_limit", asset, maxPerTx, maxDaily };
  return { id: crypto.randomUUID(), walletId, rules: [rule], createdAt: new Date() };
}

export function createVelocityPolicy(
  walletId: string,
  maxTransactions: number,
  windowMinutes: number,
): Policy {
  const rule: VelocityRule = { type: "velocity", maxTransactions, windowMinutes };
  return { id: crypto.randomUUID(), walletId, rules: [rule], createdAt: new Date() };
}

export function createAllowlistPolicy(walletId: string, destinations: string[]): Policy {
  const rule: AllowlistRule = { type: "allowlist", destinations };
  return { id: crypto.randomUUID(), walletId, rules: [rule], createdAt: new Date() };
}

export function createBlocklistPolicy(walletId: string, destinations: string[]): Policy {
  const rule: BlocklistRule = { type: "blocklist", destinations };
  return { id: crypto.randomUUID(), walletId, rules: [rule], createdAt: new Date() };
}

export function createAssetAllowlistPolicy(walletId: string, assets: string[]): Policy {
  const rule: AssetAllowlistRule = { type: "asset_allowlist", assets };
  return { id: crypto.randomUUID(), walletId, rules: [rule], createdAt: new Date() };
}

export function createTimeBoundsPolicy(
  walletId: string,
  maxWindowSeconds?: number,
  allowUnbounded?: boolean,
): Policy {
  const rule: TimeBoundsRule = { type: "timebounds", maxWindowSeconds, allowUnbounded };
  return { id: crypto.randomUUID(), walletId, rules: [rule], createdAt: new Date() };
}

export function createMaxOperationsPolicy(walletId: string, maxOperations: number): Policy {
  const rule: MaxOperationsRule = { type: "max_operations", maxOperations };
  return { id: crypto.randomUUID(), walletId, rules: [rule], createdAt: new Date() };
}

export type PolicyTemplateName = "conservative" | "payroll" | "dapp-session";

export function createConservativeTemplatePolicy(walletId: string): Policy {
  const rules: Policy["rules"] = [
    { type: "spend_limit", asset: "XLM", maxPerTx: "100", maxDaily: "500" },
    { type: "velocity", maxTransactions: 5, windowMinutes: 60 },
    { type: "allowlist", destinations: [] },
  ];
  return { id: crypto.randomUUID(), walletId, rules, createdAt: new Date() };
}

export function createPayrollTemplatePolicy(walletId: string): Policy {
  const rules: Policy["rules"] = [
    { type: "spend_limit", asset: "XLM", maxPerTx: "1000", maxDaily: "10000" },
    { type: "timebounds", maxWindowSeconds: 3600, allowUnbounded: false },
  ];
  return { id: crypto.randomUUID(), walletId, rules, createdAt: new Date() };
}

export function createDappSessionTemplatePolicy(walletId: string): Policy {
  const rules: Policy["rules"] = [
    { type: "session_key", maxDurationSeconds: 3600 },
    { type: "contract_allowlist", contracts: [] },
    { type: "max_operations", maxOperations: 10 },
  ];
  return { id: crypto.randomUUID(), walletId, rules, createdAt: new Date() };
}

export const POLICY_TEMPLATES: Record<PolicyTemplateName, (walletId: string) => Policy> = {
  conservative: createConservativeTemplatePolicy,
  payroll: createPayrollTemplatePolicy,
  "dapp-session": createDappSessionTemplatePolicy,
};

export function createPolicyFromTemplate(walletId: string, templateName: PolicyTemplateName): Policy {
  const factory = POLICY_TEMPLATES[templateName];
  if (!factory) {
    throw new Error(`Unknown policy template: ${templateName}`);
  }
  return factory(walletId);
}
