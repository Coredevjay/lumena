import http from 'k6/http';
import { check } from 'k6';

// ---------------------------------------------------------------------------
// Short smoke load run in CI on every pull request. Thresholds are documented
// in packages/server/README.md ("Load Smoke Test"); a breach fails the run.
// ---------------------------------------------------------------------------
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const RATE = parseInt(__ENV.RATE || '20', 10);
const DURATION = __ENV.DURATION || '30s';
const P95_THRESHOLD_MS = parseFloat(__ENV.P95_THRESHOLD_MS || '150');
const MAX_ERROR_RATE = parseFloat(__ENV.MAX_ERROR_RATE || '0.01');

// The smoke payloads are not signed transactions, so /cosign answers with a
// 4xx rejection. That still exercises the full middleware and validation path
// and is counted as a handled response; only 5xx responses, timeouts and
// connection errors count towards the error rate.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

export const options = {
  scenarios: {
    smoke: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
  },
  thresholds: {
    'http_req_duration{endpoint:cosign}': [`p(95)<${P95_THRESHOLD_MS}`],
    'http_req_duration{endpoint:health}': [`p(95)<${P95_THRESHOLD_MS}`],
    http_req_failed: [`rate<${MAX_ERROR_RATE}`],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const health = http.get(`${BASE_URL}/health`, {
    tags: { endpoint: 'health' },
  });
  check(health, {
    'health status is 200': (r) => r.status === 200,
  });

  const cosign = http.post(
    `${BASE_URL}/cosign`,
    JSON.stringify({ xdr: 'AAAA', walletAddress: 'smoke' }),
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      tags: { endpoint: 'cosign' },
    },
  );
  check(cosign, {
    'cosign is not a server error': (r) => r.status > 0 && r.status < 500,
  });
}
