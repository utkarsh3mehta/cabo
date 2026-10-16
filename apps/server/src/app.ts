import type { BotRng } from '@cabo/bots';
import type { Rng } from '@cabo/game-engine';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Server as SocketServer } from 'socket.io';
import type { ServerConfig } from './config.js';
import { registerHttp, type HttpState } from './http.js';
import { RoomManager } from './roomManager.js';
import { attachSocketServer, createDeferredTransport } from './sockets.js';

export interface BuildOptions {
  gameRng?: Rng;
  botRng?: BotRng;
}

export interface CaboServer {
  app: FastifyInstance;
  io: SocketServer;
  manager: RoomManager;
  state: HttpState;
  listen(): Promise<string>;
  close(): Promise<void>;
}

function contentSecurityPolicy(config: ServerConfig) {
  const connect = ["'self'"];
  if (config.publicOrigin) {
    const url = new URL(config.publicOrigin);
    connect.push(`${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`);
  }
  return {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: connect,
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: config.env === 'production' && config.publicOrigin?.startsWith('https:') ? [] : null,
    },
  };
}

/** Fastify accepts a hop count only as a function; booleans and address lists pass through. */
function fastifyTrustProxy(value: ServerConfig['trustProxy']): boolean | string | ((address: string, hop: number) => boolean) {
  if (typeof value === 'number') return (_address, hop) => hop < value;
  return value;
}

export async function buildServer(config: ServerConfig, options: BuildOptions = {}): Promise<CaboServer> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'token', '*.token'],
        censor: '[redacted]',
      },
    },
    trustProxy: fastifyTrustProxy(config.trustProxy),
    bodyLimit: 8 * 1024,
  });

  const state: HttpState = { ready: false };
  const { transport, bind } = createDeferredTransport();
  const manager = new RoomManager({
    config,
    logger: app.log,
    transport,
    ...(options.gameRng ? { gameRng: options.gameRng } : {}),
    ...(options.botRng ? { botRng: options.botRng } : {}),
  });

  await app.register(helmet, {
    contentSecurityPolicy: contentSecurityPolicy(config),
    crossOriginEmbedderPolicy: false,
    hsts: config.env === 'production' ? { maxAge: 15552000, includeSubDomains: false } : false,
  });
  await registerHttp(app, config, manager, state);
  await app.ready();

  const io = attachSocketServer(app.server, config, manager, app.log, bind);
  if (!config.publicOrigin) app.log.warn('PUBLIC_ORIGIN is not set: WebSocket origin checks are disabled (development only)');
  manager.start();

  return {
    app,
    io,
    manager,
    state,
    async listen() {
      const address = await app.listen({ host: config.host, port: config.port });
      state.ready = true;
      return address;
    },
    async close() {
      state.ready = false;
      manager.stop();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await app.close();
    },
  };
}
