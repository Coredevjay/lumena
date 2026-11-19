import { StrKey } from "@stellar/stellar-sdk";

/**
 * A resolved SEP-0002 federation record.
 */
export interface FederationRecord {
  /** The federation address that was resolved (`name*domain`). */
  stellarAddress: string;
  /** The Stellar account the address points to (G...). */
  accountId: string;
  /** Memo type the recipient requires, if any. */
  memoType?: string;
  /** Memo value the recipient requires, if any. */
  memo?: string;
}

export interface ResolveFederationOpts {
  /** Timeout for each HTTP request in milliseconds. Defaults to 10_000. */
  timeoutMs?: number;
  /** How long a resolved record is cached, in milliseconds. Defaults to 300_000. */
  cacheTtlMs?: number;
  /** Optional fetch implementation. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CACHE_TTL_MS = 300_000;

const cache = new Map<string, { record: FederationRecord; expiresAt: number }>();

/**
 * Returns true when `address` has the SEP-0002 `name*domain` form.
 */
export function isFederationAddress(address: string): boolean {
  const separator = address.lastIndexOf("*");
  if (separator <= 0 || separator === address.length - 1) {
    return false;
  }
  const name = address.slice(0, separator);
  const domain = address.slice(separator + 1);
  return (
    !name.includes("*") &&
    !/\s/.test(name) &&
    /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(domain)
  );
}

/**
 * Clears every cached federation record.
 */
export function clearFederationCache(): void {
  cache.clear();
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Federation request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function requireHttps(url: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid ${label}: "${url}" is not a valid URL`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`Invalid ${label}: "${url}" must use HTTPS`);
  }
}

/**
 * Resolves a SEP-0002 federation address (`name*domain.com`) to a Stellar
 * account.
 *
 * Looks up `FEDERATION_SERVER` in `https://<domain>/.well-known/stellar.toml`
 * and queries it with `type=name`. Both requests use HTTPS only and are
 * aborted after `timeoutMs`. Successful results are cached for `cacheTtlMs`.
 */
export async function resolveFederation(
  address: string,
  opts: ResolveFederationOpts = {},
): Promise<FederationRecord> {
  const trimmed = address.trim();
  if (!isFederationAddress(trimmed)) {
    throw new Error(`Invalid federation address "${address}": expected "name*domain"`);
  }

  const separator = trimmed.lastIndexOf("*");
  const domain = trimmed.slice(separator + 1).toLowerCase();
  const stellarAddress = `${trimmed.slice(0, separator)}*${domain}`;

  const cached = cache.get(stellarAddress);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.record;
  }

  const fetchImpl = opts.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation available. Provide one via opts.fetch.");
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const tomlUrl = `https://${domain}/.well-known/stellar.toml`;
  const tomlResponse = await fetchWithTimeout(fetchImpl, tomlUrl, timeoutMs);
  if (!tomlResponse.ok) {
    throw new Error(`Failed to load stellar.toml for ${domain}: HTTP ${tomlResponse.status}`);
  }
  const toml = await tomlResponse.text();
  const match = toml.match(/^\s*FEDERATION_SERVER\s*=\s*["']([^"']+)["']/m);
  if (!match) {
    throw new Error(`stellar.toml for ${domain} does not define FEDERATION_SERVER`);
  }
  const federationServer = match[1].trim();
  requireHttps(federationServer, "FEDERATION_SERVER");

  const queryUrl = new URL(federationServer);
  queryUrl.searchParams.set("q", stellarAddress);
  queryUrl.searchParams.set("type", "name");
  const response = await fetchWithTimeout(fetchImpl, queryUrl.toString(), timeoutMs);
  if (!response.ok) {
    throw new Error(`Federation server could not resolve ${stellarAddress}: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    account_id?: unknown;
    memo_type?: unknown;
    memo?: unknown;
  };
  if (typeof body.account_id !== "string" || !StrKey.isValidEd25519PublicKey(body.account_id)) {
    throw new Error(`Federation server returned an invalid account_id for ${stellarAddress}`);
  }

  const record: FederationRecord = { stellarAddress, accountId: body.account_id };
  if (typeof body.memo_type === "string" && body.memo_type.length > 0) {
    record.memoType = body.memo_type;
  }
  if (body.memo !== undefined && body.memo !== null && body.memo !== "") {
    record.memo = String(body.memo);
  }

  cache.set(stellarAddress, {
    record,
    expiresAt: Date.now() + (opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
  });
  return record;
}

/**
 * Resolves a payment destination: a `name*domain` federation address is
 * resolved to its account ID, anything else is returned unchanged.
 *
 * Throws when the federation record requires a memo, since the destination
 * alone cannot carry it and paying without it could lose the funds.
 */
export async function resolveDestination(
  destination: string,
  opts: ResolveFederationOpts = {},
): Promise<string> {
  if (!isFederationAddress(destination.trim())) {
    return destination;
  }
  const record = await resolveFederation(destination, opts);
  if (record.memo !== undefined) {
    throw new Error(
      `Federation address ${record.stellarAddress} requires a memo (${record.memoType ?? "text"}: ${record.memo})`,
    );
  }
  return record.accountId;
}
