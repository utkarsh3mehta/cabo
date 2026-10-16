import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4173);
/** Set E2E_BASE_URL to test an already running deployment (for example the Docker container). */
const EXTERNAL_URL = process.env.E2E_BASE_URL;
const BASE_URL = EXTERNAL_URL ?? `http://localhost:${PORT}`;

/**
 * Browser end-to-end tests run against the production build
 * (`pnpm build` first) served by the real Node server in production mode.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    // Only for local HTTPS checks through Caddy's internal certificate authority.
    ignoreHTTPSErrors: process.env.E2E_IGNORE_HTTPS_ERRORS === '1',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: EXTERNAL_URL ? undefined : {
    command: 'node apps/server/dist/index.js',
    url: `${BASE_URL}/readyz`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NODE_ENV: 'production',
      PORT: String(PORT),
      HOST: '127.0.0.1',
      PUBLIC_ORIGIN: BASE_URL,
      LOG_LEVEL: 'warn',
      BOT_DELAY_MIN_MS: '40',
      BOT_DELAY_MAX_MS: '120',
      RECONNECT_GRACE_MS: '3000',
      RATE_LIMIT_CREATE_PER_MIN: '1000',
      RATE_LIMIT_JOIN_PER_MIN: '1000',
      RATE_LIMIT_LOOKUP_PER_MIN: '1000',
      MAX_CONNECTIONS_PER_IP: '500',
    },
  },
});
