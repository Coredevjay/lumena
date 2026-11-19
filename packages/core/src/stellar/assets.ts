import { Asset } from "@stellar/stellar-sdk";
import type { StellarClient } from "./client.js";

export const KNOWN_ASSETS: Record<string, Record<string, Asset>> = {
  testnet: {
    USDC: new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
    BTC: new Asset("BTC", "GDLG3LO3ILCROFOFASXRWYNO2RHSGHA2BHK3M4PGELIL33WM63HCR7UA"),
    ETH: new Asset("ETH", "GBEIOZR3L4ITBRBE6E3V3CKWXX4CSF6R6J53YDKO3IIBSPULZYJPFLBD"),
    NGNT: new Asset("NGNT", "GD5YO3NKOR25EVPZELPRGDQEUZ42J44INT3AFLFTWVIVYMHKAXXNRQVH"),
  },
  mainnet: {
    USDC: new Asset("USDC", "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"),
  },
};

export function getAsset(code: string, issuer: string): Asset {
  return new Asset(code, issuer);
}

export function getNativeAsset(): Asset {
  return Asset.native();
}

export interface AssetFlags {
  authRequired: boolean;
  authRevocable: boolean;
  authImmutable: boolean;
  clawbackEnabled: boolean;
}

export interface GetAssetFlagsOpts {
  /** How long a result stays cached, in milliseconds. Defaults to 5 minutes. */
  ttlMs?: number;
}

const DEFAULT_ASSET_FLAGS_TTL_MS = 5 * 60_000;
const assetFlagsCache = new Map<string, { flags: AssetFlags; expiresAt: number }>();

/**
 * Reads the authorization and clawback flags of an asset from its issuer
 * account. Results are cached per asset for `ttlMs`.
 */
export async function getAssetFlags(
  asset: Asset,
  client: StellarClient,
  opts: GetAssetFlagsOpts = {},
): Promise<AssetFlags> {
  if (asset.isNative()) {
    return {
      authRequired: false,
      authRevocable: false,
      authImmutable: false,
      clawbackEnabled: false,
    };
  }

  const key = `${asset.getCode()}:${asset.getIssuer()}`;
  const cached = assetFlagsCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.flags;
  }

  const issuer = await client.horizon.loadAccount(asset.getIssuer());
  const flags: AssetFlags = {
    authRequired: Boolean(issuer.flags.auth_required),
    authRevocable: Boolean(issuer.flags.auth_revocable),
    authImmutable: Boolean(issuer.flags.auth_immutable),
    clawbackEnabled: Boolean(issuer.flags.auth_clawback_enabled),
  };
  assetFlagsCache.set(key, {
    flags,
    expiresAt: Date.now() + (opts.ttlMs ?? DEFAULT_ASSET_FLAGS_TTL_MS),
  });
  return flags;
}

/** Returns user-facing warnings for flags that change how an asset behaves. */
export function getAssetFlagWarnings(flags: AssetFlags): string[] {
  const warnings: string[] = [];
  if (flags.authRequired) {
    warnings.push("The issuer must authorize your trustline before you can hold this asset.");
  }
  if (flags.authRevocable) {
    warnings.push("The issuer can freeze this asset in your account.");
  }
  if (flags.clawbackEnabled) {
    warnings.push("The issuer can claw back this asset from your account.");
  }
  return warnings;
}
