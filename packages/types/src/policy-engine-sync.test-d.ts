import type { PolicyRule } from "./policy.js";

type EngineRule =
  | "spend_limit"
  | "velocity"
  | "allowlist"
  | "blocklist"
  | "asset_allowlist"
  | "session_key"
  | "timebounds"
  | "max_operations"
  | "fee_limit"
  | "contract_allowlist";

type UnionRule = PolicyRule["type"];

type _EngineSubset = Extract<UnionRule, EngineRule>;
type _UnionCoversEngine = EngineRule extends UnionRule ? true : never;

declare const engineCovered: _UnionCoversEngine;
void engineCovered;