import { existsSync } from 'node:fs';
import { join } from 'node:path';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import {
  createRoomRequestSchema,
  joinRoomRequestSchema,
  normalizeRoomCode,
  safeError,
  type ErrorCode,
} from '@cabo/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ServerConfig } from './config.js';
import { RoomError } from './room.js';
import type { RoomManager } from './roomManager.js';

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  ROOM_NOT_FOUND: 404,
  INVALID_ROOM_CODE: 400,
  INVALID_NAME: 400,
  INVALID_PAYLOAD: 400,
  ROOM_FULL: 409,
  GAME_IN_PROGRESS: 409,
  SERVER_FULL: 503,
  RATE_LIMITED: 429,
};

function sendError(reply: FastifyReply, code: ErrorCode): FastifyReply {
  return reply.code(STATUS_BY_CODE[code] ?? 400).send({ error: safeError(code) });
}

function handleRoomError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof RoomError) return sendError(reply, err.code);
  throw err;
}

export interface HttpState {
  ready: boolean;
}

export async function registerHttp(
  app: FastifyInstance,
  config: ServerConfig,
  manager: RoomManager,
  state: HttpState,
): Promise<void> {
  app.setErrorHandler((error: { statusCode?: number; validation?: unknown }, request, reply) => {
    if (error.statusCode === 429) return sendError(reply, 'RATE_LIMITED');
    if (error.validation || error.statusCode === 400 || error.statusCode === 413 || error.statusCode === 415) {
      return sendError(reply, 'INVALID_PAYLOAD');
    }
    request.log.error({ err: error }, 'unhandled request error');
    return reply.code(500).send({ error: safeError('INTERNAL_ERROR') });
  });

  await app.register(rateLimit, { global: false });

  app.get('/healthz', { logLevel: 'warn' }, async () => ({ status: 'ok' }));
  app.get('/readyz', { logLevel: 'warn' }, async (_request, reply) => {
    if (!state.ready) return reply.code(503).send({ status: 'unavailable' });
    return { status: 'ready' };
  });

  app.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.post(
    '/api/rooms',
    { config: { rateLimit: { max: config.rateLimits.createPerMin, timeWindow: 60_000 } } },
    async (request, reply) => {
      const parsed = createRoomRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 'INVALID_PAYLOAD');
      try {
        return reply.code(201).send(manager.createRoom(parsed.data));
      } catch (err) {
        return handleRoomError(reply, err);
      }
    },
  );

  app.post<{ Params: { code: string } }>(
    '/api/rooms/:code/join',
    { config: { rateLimit: { max: config.rateLimits.joinPerMin, timeWindow: 60_000 } } },
    async (request, reply) => {
      const parsed = joinRoomRequestSchema.safeParse(request.body);
      if (!parsed.success) return sendError(reply, 'INVALID_PAYLOAD');
      try {
        return reply.code(201).send(manager.joinRoom(request.params.code, parsed.data.name));
      } catch (err) {
        return handleRoomError(reply, err);
      }
    },
  );

  app.get<{ Params: { code: string } }>(
    '/api/rooms/:code',
    { config: { rateLimit: { max: config.rateLimits.lookupPerMin, timeWindow: 60_000 } } },
    async (request, reply) => {
      if (!normalizeRoomCode(request.params.code)) return sendError(reply, 'INVALID_ROOM_CODE');
      const room = manager.getRoom(request.params.code);
      if (!room) return sendError(reply, 'ROOM_NOT_FOUND');
      return room.info();
    },
  );

  const webDir = config.webDistDir;
  if (webDir && existsSync(join(webDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDir,
      // With wildcard disabled, a route is registered for each file in the build.
      wildcard: false,
      index: false,
      setHeaders(res, filePath) {
        if (/[\\/]assets[\\/]/.test(filePath)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
    app.setNotFoundHandler((request, reply) => {
      const isPage = request.method === 'GET' && !request.url.startsWith('/api/') && !request.url.startsWith('/socket.io');
      if (isPage) return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    });
  } else {
    app.log.warn({ webDir }, 'web build not found; serving API only');
  }
}
