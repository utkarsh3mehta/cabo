import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const intFromEnv = (fallback: number, min = 0) => z.coerce.number().int().min(min).default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: intFromEnv(3000, 0),
  /** Public origin of the site, e.g. https://cabo.example.com. Used for CORS and invitation links. */
  PUBLIC_ORIGIN: z.string().url().optional(),
  /** Fastify trustProxy: "true", "false", a hop count, or a comma-separated list of addresses/CIDRs. */
  TRUST_PROXY: z.string().default('false'),
  WEB_DIST_DIR: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RECONNECT_GRACE_MS: intFromEnv(60_000),
  ROOM_IDLE_TTL_MS: intFromEnv(15 * 60_000),
  FINISHED_ROOM_TTL_MS: intFromEnv(30 * 60_000),
  ROOM_MAX_AGE_MS: intFromEnv(12 * 60 * 60_000),
  SWEEP_INTERVAL_MS: intFromEnv(30_000, 100),
  MAX_ROOMS: intFromEnv(1000, 1),
  BOT_DELAY_MIN_MS: intFromEnv(700),
  BOT_DELAY_MAX_MS: intFromEnv(1500),
  MAX_CONNECTIONS_PER_IP: intFromEnv(30, 1),
  RATE_LIMIT_CREATE_PER_MIN: intFromEnv(10, 1),
  RATE_LIMIT_JOIN_PER_MIN: intFromEnv(30, 1),
  RATE_LIMIT_LOOKUP_PER_MIN: intFromEnv(60, 1),
});

export interface ServerConfig {
  env: 'development' | 'production' | 'test';
  host: string;
  port: number;
  publicOrigin: string | null;
  trustProxy: boolean | number | string;
  webDistDir: string | null;
  logLevel: string;
  reconnectGraceMs: number;
  roomIdleTtlMs: number;
  finishedRoomTtlMs: number;
  roomMaxAgeMs: number;
  sweepIntervalMs: number;
  maxRooms: number;
  botDelayMinMs: number;
  botDelayMaxMs: number;
  maxConnectionsPerIp: number;
  rateLimits: { createPerMin: number; joinPerMin: number; lookupPerMin: number };
}

function parseTrustProxy(raw: string): boolean | number | string {
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return raw.trim();
}

function defaultWebDist(): string {
  // dist/index.js -> ../../web/dist  (also correct for src/ when run with tsx)
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', 'web', 'dist');
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && !e.PUBLIC_ORIGIN) {
    throw new Error('PUBLIC_ORIGIN must be set in production (for example https://cabo.example.com)');
  }
  if (e.BOT_DELAY_MAX_MS < e.BOT_DELAY_MIN_MS) throw new Error('BOT_DELAY_MAX_MS must be >= BOT_DELAY_MIN_MS');
  const config: ServerConfig = {
    env: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    publicOrigin: e.PUBLIC_ORIGIN ? new URL(e.PUBLIC_ORIGIN).origin : null,
    trustProxy: parseTrustProxy(e.TRUST_PROXY),
    webDistDir: e.WEB_DIST_DIR ?? defaultWebDist(),
    logLevel: e.LOG_LEVEL,
    reconnectGraceMs: e.RECONNECT_GRACE_MS,
    roomIdleTtlMs: e.ROOM_IDLE_TTL_MS,
    finishedRoomTtlMs: e.FINISHED_ROOM_TTL_MS,
    roomMaxAgeMs: e.ROOM_MAX_AGE_MS,
    sweepIntervalMs: e.SWEEP_INTERVAL_MS,
    maxRooms: e.MAX_ROOMS,
    botDelayMinMs: e.BOT_DELAY_MIN_MS,
    botDelayMaxMs: e.BOT_DELAY_MAX_MS,
    maxConnectionsPerIp: e.MAX_CONNECTIONS_PER_IP,
    rateLimits: {
      createPerMin: e.RATE_LIMIT_CREATE_PER_MIN,
      joinPerMin: e.RATE_LIMIT_JOIN_PER_MIN,
      lookupPerMin: e.RATE_LIMIT_LOOKUP_PER_MIN,
    },
  };
  return { ...config, ...overrides };
}
