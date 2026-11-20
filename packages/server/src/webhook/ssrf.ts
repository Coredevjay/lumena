import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";

/**
 * SSRF protection for webhook destination URLs.
 *
 * Webhook URLs are attacker-controlled, so they must never be allowed to
 * reach loopback, private, link-local or otherwise internal addresses.
 * Validation happens twice: once at registration time and again immediately
 * before every delivery attempt (DNS rebinding).
 */

export class WebhookUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookUrlError";
  }
}

/** Resolves a hostname to its IP addresses. Injectable for tests. */
export type DnsResolver = (hostname: string) => Promise<string[]>;

export interface WebhookUrlGuardOpts {
  /**
   * Allow plain `http:` destinations. Only ever enable this in development;
   * production requires `https:`.
   */
  allowInsecureHttp?: boolean;
  /** Allow private/loopback/link-local destinations. Development only. */
  allowPrivateNetworks?: boolean;
  /** Override DNS resolution (tests). */
  resolver?: DnsResolver;
}

/** Maximum number of redirects followed for a single delivery. */
export const WEBHOOK_MAX_REDIRECTS = 3;

const defaultResolver: DnsResolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function inV4Range(ip: number, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split("/");
  const bits = Number(bitsRaw);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_V4_RANGES = [
  "0.0.0.0/8", // "this" network
  "10.0.0.0/8", // private
  "100.64.0.0/10", // carrier-grade NAT
  "127.0.0.0/8", // loopback
  "169.254.0.0/16", // link-local (incl. cloud metadata)
  "172.16.0.0/12", // private
  "192.0.0.0/24", // IETF protocol assignments
  "192.168.0.0/16", // private
  "198.18.0.0/15", // benchmarking
  "224.0.0.0/4", // multicast
  "240.0.0.0/4", // reserved
];

/** True when the given IP literal is not a public, routable address. */
export function isBlockedIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    const value = ipv4ToInt(address);
    return BLOCKED_V4_RANGES.some((cidr) => inV4Range(value, cidr));
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible forms.
    const mapped = normalized.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    if (normalized === "::" || normalized === "::1") return true;
    if (/^f[cd]/.test(normalized)) return true; // unique local fc00::/7
    if (/^fe[89ab]/.test(normalized)) return true; // link-local fe80::/10
    if (/^ff/.test(normalized)) return true; // multicast
    return false;
  }
  return true; // not an IP literal at all
}

/**
 * Validate a webhook destination URL. Throws `WebhookUrlError` when the URL
 * is malformed, uses a disallowed scheme, or resolves to a blocked address.
 */
export async function assertSafeWebhookUrl(
  rawUrl: string,
  opts: WebhookUrlGuardOpts = {},
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookUrlError("Webhook URL is not a valid absolute URL");
  }

  if (url.protocol !== "https:" && !(opts.allowInsecureHttp && url.protocol === "http:")) {
    throw new WebhookUrlError("Webhook URL must use https");
  }
  if (url.username || url.password) {
    throw new WebhookUrlError("Webhook URL must not contain credentials");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (!hostname) {
    throw new WebhookUrlError("Webhook URL must include a hostname");
  }

  if (opts.allowPrivateNetworks) return url;

  if (net.isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new WebhookUrlError(`Webhook URL resolves to a blocked address: ${hostname}`);
    }
    return url;
  }

  const resolver = opts.resolver ?? defaultResolver;
  let addresses: string[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new WebhookUrlError(`Webhook hostname could not be resolved: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new WebhookUrlError(`Webhook hostname could not be resolved: ${hostname}`);
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new WebhookUrlError(`Webhook URL resolves to a blocked address: ${address}`);
    }
  }

  return url;
}

/**
 * `fetch` wrapper that re-validates every hop, so a redirect cannot be used
 * to reach an internal address. Redirects are followed manually and capped.
 */
export async function safeWebhookFetch(
  rawUrl: string,
  init: RequestInit,
  opts: WebhookUrlGuardOpts = {},
): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= WEBHOOK_MAX_REDIRECTS; hop++) {
    await assertSafeWebhookUrl(current, opts);
    const res = await fetch(current, { ...init, redirect: "manual" });
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers.get("location");
    if (!isRedirect || !location) return res;
    if (hop === WEBHOOK_MAX_REDIRECTS) {
      throw new WebhookUrlError("Webhook delivery exceeded the redirect limit");
    }
    current = new URL(location, current).toString();
  }
  throw new WebhookUrlError("Webhook delivery exceeded the redirect limit");
}
