import { randomUUID } from 'node:crypto';
import { SOCKET_PATH, type SessionResponse } from '@cabo/shared';
import { io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { connectClient, createRoom, expectOk, joinRoom, startTestServer, type TestClient, type TestServer } from './harness.js';

let t: TestServer;
const clients: TestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.socket?.disconnect();
  await t?.close();
});

async function client(session: SessionResponse) {
  const c = await connectClient(t.url, session);
  clients.push(c);
  return c;
}

function connectError(token: unknown): Promise<{ message: string; data?: unknown }> {
  return new Promise((resolve, reject) => {
    const s = io(t.url, { path: SOCKET_PATH, auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
    s.on('connect', () => {
      s.disconnect();
      reject(new Error('unexpectedly connected'));
    });
    s.on('connect_error', (err: Error & { data?: unknown }) => {
      s.disconnect();
      resolve({ message: err.message, data: err.data });
    });
  });
}

describe('socket authentication', () => {
  it('rejects missing, malformed and forged tokens', async () => {
    t = await startTestServer();
    await createRoom(t.url, { name: 'Ada' });
    expect((await connectError(undefined)).message).toBe('INVALID_SESSION');
    expect((await connectError('short')).message).toBe('INVALID_SESSION');
    expect((await connectError('A'.repeat(43))).message).toBe('INVALID_SESSION');
  });

  it('binds the connection to the seat of the token, never to a claimed identity', async () => {
    t = await startTestServer();
    const host = await createRoom(t.url, { name: 'Ada' });
    const guest = await joinRoom(t.url, host.roomCode, 'Bob');
    const bob = await client(guest);
    expect(bob.latest().you).toEqual({ playerId: guest.playerId, isHost: false });
    // A command cannot name another actor: strict schemas reject the extra field.
    const forged = await bob.raw({ actionId: randomUUID(), command: { type: 'startGame', playerId: host.playerId } });
    expect(forged).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    expect(await bob.send({ type: 'startGame' })).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
  });
});

describe('lobby', () => {
  it('shows participants, host, connection status and settings to everyone', async () => {
    t = await startTestServer();
    const host = await createRoom(t.url, { name: 'Ada', mode: 'quick', allowBots: false });
    const ada = await client(host);
    const guest = await joinRoom(t.url, host.roomCode, 'Bob');
    const bob = await client(guest);
    const v = await ada.waitFor((x) => x.participants.length === 2 && x.participants.every((p) => p.connected));
    expect(v.settings).toEqual({ mode: 'quick', allowBots: false });
    expect(v.participants.map((p) => [p.name, p.kind, p.isHost])).toEqual([
      ['Ada', 'human', true],
      ['Bob', 'human', false],
    ]);
    bob.disconnect();
    await ada.waitFor((x) => x.participants[1]?.connected === false, 3000, 'bob disconnected');
  });

  it('enforces host-only controls and the bot setting', async () => {
    t = await startTestServer();
    const host = await createRoom(t.url, { name: 'Ada', allowBots: false });
    const ada = await client(host);
    const bob = await client(await joinRoom(t.url, host.roomCode, 'Bob'));
    expect(await ada.send({ type: 'addBot' })).toMatchObject({ ok: false, error: { code: 'BOTS_NOT_ALLOWED' } });
    expect(await bob.send({ type: 'updateSettings', allowBots: true })).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expectOk(await ada.send({ type: 'updateSettings', allowBots: true }));
    expectOk(await ada.send({ type: 'addBot' }));
    expect(await bob.send({ type: 'addBot' })).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    const v = await ada.waitFor((x) => x.participants.length === 3);
    const bot = v.participants.find((p) => p.kind === 'bot')!;
    expect(bot.connected).toBe(true);
    expect(await bob.send({ type: 'removeBot', playerId: bot.playerId })).toMatchObject({ ok: false, error: { code: 'NOT_HOST' } });
    expect(await ada.send({ type: 'removeBot', playerId: bob.playerId })).toMatchObject({ ok: false, error: { code: 'PLAYER_NOT_FOUND' } });
    expectOk(await ada.send({ type: 'removeBot', playerId: bot.playerId }));
    // Turning bots off removes seated bots.
    expectOk(await ada.send({ type: 'addBot' }));
    expectOk(await ada.send({ type: 'updateSettings', allowBots: false }));
    await ada.waitFor((x) => x.participants.every((p) => p.kind === 'human'));
  });

  it('requires 2–5 participants to start and fills seats with bots up to 5', async () => {
    t = await startTestServer();
    const host = await createRoom(t.url, { name: 'Ada' });
    const ada = await client(host);
    expect(await ada.send({ type: 'startGame' })).toMatchObject({ ok: false, error: { code: 'NOT_ENOUGH_PLAYERS' } });
    for (let i = 0; i < 4; i++) expectOk(await ada.send({ type: 'addBot' }));
    expect(await ada.send({ type: 'addBot' })).toMatchObject({ ok: false, error: { code: 'ROOM_FULL' } });
    expectOk(await ada.send({ type: 'startGame' }));
    const v = await ada.waitFor((x) => x.phase === 'playing');
    expect(v.game?.players).toHaveLength(5);
    expect(await ada.send({ type: 'startGame' })).toMatchObject({ ok: false, error: { code: 'WRONG_ROOM_PHASE' } });
  });

  it('seats bots immediately for solo games', async () => {
    t = await startTestServer();
    const solo = await createRoom(t.url, { name: 'Ada', botCount: 3, allowBots: false });
    const ada = await client(solo);
    const v = ada.latest();
    expect(v.participants.map((p) => p.kind)).toEqual(['human', 'bot', 'bot', 'bot']);
    expect(v.settings.allowBots).toBe(true);
    expect(new Set(v.participants.map((p) => p.name)).size).toBe(4);
  });

  it('lets players rename themselves in the lobby with validation', async () => {
    t = await startTestServer();
    const ada = await client(await createRoom(t.url, { name: 'Ada' }));
    expectOk(await ada.send({ type: 'setName', name: 'Ada L.' }));
    await ada.waitFor((x) => x.participants[0]?.name === 'Ada L.');
    expect(await ada.send({ type: 'setName', name: ' ' })).toMatchObject({ ok: false, error: { code: 'INVALID_NAME' } });
  });

  it('passes the host role on when the host leaves the lobby and closes empty rooms', async () => {
    t = await startTestServer();
    const host = await createRoom(t.url, { name: 'Ada' });
    const ada = await client(host);
    const bob = await client(await joinRoom(t.url, host.roomCode, 'Bob'));
    expectOk(await ada.send({ type: 'leave' }));
    const v = await bob.waitFor((x) => x.participants.length === 1);
    expect(v.you.isHost).toBe(true);
    expectOk(await bob.send({ type: 'leave' }));
    expect(t.server.manager.getRoom(host.roomCode)).toBeUndefined();
  });

  it('rejects malformed commands without side effects', async () => {
    t = await startTestServer();
    const ada = await client(await createRoom(t.url, { name: 'Ada' }));
    const before = ada.latest().version;
    for (const payload of [null, 42, 'x', {}, { actionId: 'short', command: { type: 'addBot' } }, { actionId: randomUUID(), command: { type: 'nuke' } }, { actionId: randomUUID(), command: { type: 'game', action: { type: 'match', slots: [0, 0] } } }]) {
      expect(await ada.raw(payload)).toMatchObject({ ok: false, error: { code: 'INVALID_PAYLOAD' } });
    }
    expect(t.server.manager.getRoom(ada.session.roomCode)!.version).toBe(before);
  });
});
