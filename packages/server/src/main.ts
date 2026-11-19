import { startTracing } from "./tracing.js";

// Must run before any other module is loaded so auto-instrumentation can patch
// Express, ioredis, and undici before they are required.
startTracing();

const { createServer } = await import("./server.js");
const { EnvSigner, AwsKmsSigner } = await import("./signers/index.js");
const { logger } = await import("./logger.js");
import type { Signer } from "@lumen/types";
import { logger } from "./logger.js";
import { registerShutdownHandlers } from "./lifecycle.js";
import { loadConfig } from "./config.js";
import { registerReloadHandler } from "./reload.js";
import {
  buildNetworkRegistry,
  parseNetworkRegistryConfig,
} from "./networkRegistry.js";

// Parse and validate configuration before anything else starts. Invalid or
// unsafe combinations (e.g. CORS_ORIGINS="*" together with credentials/API
// keys) throw here so the process fails fast instead of serving traffic.
const config = loadConfig(process.env);
logger.setLevel?.(config.logLevel);

/**
 * SIGNER_PROVIDER controls how private keys are accessed:
 *
 *   env     (default) — raw secrets from COSIGNER_SECRET / FEE_PAYER_SECRET.
 *                       Fine for local development and testnet.
 *                       ⚠  Do NOT use in production with real user funds.
 *
 *   awskms  (recommended for production) — keys live inside AWS KMS / CloudHSM.
 *                       Set KMS_COSIGNER_KEY_ID, KMS_FEE_PAYER_KEY_ID, and
 *                       KMS_REGION.  Requires @aws-sdk/client-kms and IAM
 *                       permissions; see AwsKmsSigner.ts for details.
 *
 * See docs/production-key-management.md for the full production checklist.
 */
const signerProvider = (process.env.SIGNER_PROVIDER ?? "env").toLowerCase();

async function buildSigners(): Promise<{ cosigner: Signer; feePayer: Signer }> {
  if (signerProvider === "awskms") {
    logger.info("Using AWS KMS signers (SIGNER_PROVIDER=awskms)");
    const [cosigner, feePayer] = await Promise.all([
      AwsKmsSigner.fromEnv("KMS_COSIGNER_KEY_ID"),
      AwsKmsSigner.fromEnv("KMS_FEE_PAYER_KEY_ID"),
    ]);
    return { cosigner, feePayer };
  }

  // Default: env-based signers (dev / testnet).
  if (signerProvider !== "env") {
    logger.warn(
      `Unknown SIGNER_PROVIDER="${signerProvider}", falling back to "env". ` +
        "Valid values: env, awskms.",
    );
  }

  const cosignerSecret = process.env.COSIGNER_SECRET;
  const feePayerSecret = process.env.FEE_PAYER_SECRET;

  if (!cosignerSecret || !feePayerSecret) {
    logger.error(
      "Missing COSIGNER_SECRET or FEE_PAYER_SECRET.\n" +
        "For production, set SIGNER_PROVIDER=awskms and configure KMS keys.\n" +
        "See docs/production-key-management.md.",
    );
    process.exit(1);
  }

  return {
    cosigner: new EnvSigner(cosignerSecret),
    feePayer: new EnvSigner(feePayerSecret),
  };
}

const { cosigner, feePayer } = await buildSigners();

// Multi-network support: a single process can serve tenants on different
// Stellar networks (e.g. testnet and mainnet). The registry maps tenant/API
// key -> network settings (horizon/rpc/passphrase/sponsor). STELLAR_NETWORK
// (plus HORIZON_URL / SOROBAN_RPC_URL) remains the default network used for
// tenants without an explicit mapping.
//
// Configure per-tenant mappings via NETWORK_REGISTRY (JSON) or
// NETWORK_REGISTRY_FILE (path to a JSON file). See docs/multi-network.md.
const defaultNetwork = (process.env.STELLAR_NETWORK as any) ?? "testnet";
const networkRegistryConfig = parseNetworkRegistryConfig(process.env);
const networkRegistry = buildNetworkRegistry({
  defaultNetwork,
  defaultHorizonUrl: process.env.HORIZON_URL,
  defaultRpcUrl: process.env.SOROBAN_RPC_URL,
  config: networkRegistryConfig,
});

const serverResult = createServer({
  port: config.port,
  network: defaultNetwork,
  horizonUrl: process.env.HORIZON_URL,
  rpcUrl: process.env.SOROBAN_RPC_URL,
  networkRegistry,
  horizonUrls,
  rpcUrls,
  fraudMaxRiskScore,
  fraudVelocityMultiplier,
  policyStore,
  walletRegistry: policyStore,
  cosignerSigner: cosigner,
  feePayerSigner: feePayer,
  apiKey: config.apiKey,
  corsOrigins: config.corsOrigins,
  logLevel: config.logLevel,
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  // Slow-client / slowloris protection. These are applied to the underlying
  // HTTP server (server.headersTimeout, server.requestTimeout,
  // server.keepAliveTimeout) and are NOT reloadable via SIGHUP — changing them
  // requires a restart.
  httpHeadersTimeoutMs: config.httpHeadersTimeoutMs,
  httpRequestTimeoutMs: config.httpRequestTimeoutMs,
  httpKeepAliveTimeoutMs: config.httpKeepAliveTimeoutMs,
});
serverResult.sponsorMonitorService.start();

// SIGHUP reloads non-critical settings (log level, rate limits, CORS
// allowlist). Invalid configs are logged and the previous values are kept.
// Reloadable: LOG_LEVEL, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, CORS_ORIGINS,
// NETWORK_REGISTRY / NETWORK_REGISTRY_FILE (per-tenant network mappings).
// Not reloadable (require restart): PORT, API_KEY, signer/KMS settings,
// STELLAR_NETWORK, HORIZON_URL, SOROBAN_RPC_URL (the default network).
registerReloadHandler({
  reload: () => serverResult.reloadConfig(),
});

// Install SIGINT/SIGTERM handlers so Kubernetes pod rollouts drain in-flight
// co-sign and submit operations before the process exits cleanly (code 0).
registerShutdownHandlers({
  server: serverResult.server,
  redis: serverResult.redis,
  gracePeriodMs: process.env.SHUTDOWN_GRACE_PERIOD_MS
    ? parseInt(process.env.SHUTDOWN_GRACE_PERIOD_MS)
    : undefined,
});