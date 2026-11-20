import { z } from "zod";

export const SpendLimitSchema = z.object({
  type: z.literal("spend_limit"),
  asset: z.string(),
  maxPerTx: z.string(),
  maxDaily: z.string(),
});

export const PolicyRuleSchema = z.discriminatedUnion("type", [
  SpendLimitSchema,
  z.object({ type: z.literal("velocity"), maxTransactions: z.number(), windowMinutes: z.number() }),
  z.object({ type: z.literal("timebounds"), notBefore: z.string().optional(), notAfter: z.string().optional() }),
]);

export const PolicySchema = z.object({
  id: z.string(),
  walletId: z.string(),
  rules: z.array(PolicyRuleSchema),
  version: z.number().int().positive(),
});

export type PolicyFromSchema = z.infer<typeof PolicySchema>;