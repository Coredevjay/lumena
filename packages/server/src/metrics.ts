import client from "prom-client";
import type { Request } from "express";

export const register = new client.Registry();

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;
const LONG_HEX_RE = /^[0-9a-fA-F]{16,}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Normalise a single path segment so that identifiers (Stellar public keys,
 * long hex strings, UUIDs) never leak into metric labels.
 */
function sanitiseSegment(segment: string): string {
  if (STELLAR_PUBLIC_KEY_RE.test(segment)) return ":id";
  if (UUID_RE.test(segment)) return ":id";
  if (LONG_HEX_RE.test(segment)) return ":id";
  return segment;
}

/**
 * Resolve the low-cardinality route label for a request.
 *
 * Prefers the matched Express route template (e.g. `/policy/:walletId`) so that
 * raw paths such as `/policy/GABC...` never become label values. Falls back to
 * a sanitised version of the raw path when no route has been matched yet.
 */
export function resolveRouteLabel(req: Request): string {
  const routePath = (req.route as { path?: string } | undefined)?.path;
  if (routePath) {
    const base = req.baseUrl ?? "";
    return `${base}${routePath}` || "/";
  }

  const rawPath = (req.path ?? req.url ?? "/").split("?")[0];
  const segments = rawPath.split("/").map(sanitiseSegment);
  const sanitised = segments.join("/");
  return sanitised || "/";
}

client.collectDefaultMetrics({ register, prefix: "lumen_" });

export const cosignRequestsTotal = new client.Counter({
  name: "lumen_cosign_requests_total",
  help: "Total number of co-sign requests processed",
  labelNames: ["status"],
  registers: [register],
});

export const feeBumpRequestsTotal = new client.Counter({
  name: "lumen_fee_bump_requests_total",
  help: "Total number of fee-bump requests processed",
  registers: [register],
});

export const feeSponsorResequenceTotal = new client.Counter({
  name: "lumen_fee_sponsor_resequence_total",
  help: "Total number of fee-sponsor resequence events (e.g. tx_bad_seq retries)",
  labelNames: ["reason"],
  registers: [register],
});

export const sponsorBalanceXlm = new client.Gauge({
  name: "lumen_sponsor_balance_xlm",
  help: "Current balance of fee sponsor account in XLM",
  registers: [register],
});

export const policyEvaluationDurationSeconds = new client.Histogram({
  name: "lumen_policy_evaluation_duration_seconds",
  help: "Duration of policy evaluations in seconds",
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register],
});

/**
 * Buckets for co-sign latency.
 *
 * Co-signing involves a policy evaluation plus a Stellar submission round-trip,
 * so typical successful requests land in the 50ms–1s range while failures
 * (timeouts, retries) can take several seconds. The buckets are chosen to give
 * fine resolution around the expected p50/p95 (0.025–0.5s) and coarser
 * resolution for the long tail up to 10s, which keeps the number of series
 * bounded while still allowing meaningful SLO alerting.
 */
export const COSIGN_LATENCY_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

export const cosignDurationSeconds = new client.Histogram({
  name: "lumen_cosign_duration_seconds",
  help: "Duration of co-sign requests in seconds",
  labelNames: ["status"],
  buckets: COSIGN_LATENCY_BUCKETS,
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: "lumen_http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds by route pattern and status",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestsTotal = new client.Counter({
  name: "lumen_http_requests_total",
  help: "Total number of HTTP requests by route pattern and status",
  labelNames: ["method", "route", "status"],
  registers: [register],
});

export const stellarEndpointRequestsTotal = new client.Counter({
  name: "lumen_stellar_endpoint_requests_total",
  help: "Total number of requests routed to each Stellar endpoint by outcome",
  labelNames: ["endpoint", "status"],
  registers: [register],
});

export const stellarEndpointLatencyMs = new client.Gauge({
  name: "lumen_stellar_endpoint_latency_ms",
  help: "Last measured latency of each Stellar endpoint in milliseconds",
  labelNames: ["endpoint"],
  registers: [register],
});

export const stellarEndpointHealthy = new client.Gauge({
  name: "lumen_stellar_endpoint_healthy",
  help: "Health status of each Stellar endpoint (1 = healthy, 0 = unhealthy)",
  labelNames: ["endpoint"],
  registers: [register],
});

export const stellarHealthyEndpoints = new client.Gauge({
  name: "lumen_stellar_healthy_endpoints",
  help: "Number of Stellar endpoints currently considered healthy",
  registers: [register],
});

export const stellarTotalEndpoints = new client.Gauge({
  name: "lumen_stellar_total_endpoints",
  help: "Number of Stellar endpoints configured for failover routing",
  registers: [register],
});