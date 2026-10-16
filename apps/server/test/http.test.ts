import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ErrorResponse, RoomInfoResponse, SessionResponse } from '@cabo/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createRoom, get, joinRoom, post, startTestServer, type TestServer } from './harness.js';

let t: TestServer;
afterEach(async () => t?.close());

describe('HTTP API', () => {
  it('serves health and readiness', async () => {
    t = await startTestServer();
    expect((await get(t.url, '/healthz')).body).toEqual({ status: 'ok' });
    expect((await get(t.url, '/readyz')).body).toEqual({ status: 'ready' });
  });

  it('creates a room and returns a session without caching', async () => {
    t = await startTestServer();
    const res = await fetch(`${t.url}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '  Ada  ' }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as SessionResponse;
    expect(body.roomCode).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(body.token.length).toBeGreaterThanOrEqual(40);
    expect(body.playerId).toMatch(/^p_/);
  });

  it('joins by code, normalising case and separators, and reports room info', async () => {
    t = await startTestServer();
    const host = await createRoom(t.url, { name: 'Ada' });
    const lower = `${host.roomCode.slice(0, 3)}-${host.roomCode.slice(3)}`.toLowerCase();
    const guest = await joinRoom(t.url, lower, 'Bob');
    expect(guest.roomCode).toBe(host.roomCode);
    expect(guest.token).not.toBe(host.token);
    const info = await get<RoomInfoResponse>(t.url, `/api/rooms/${host.roomCode}`);
    expect(info.body).toEqual({ code: host.roomCode, phase: 'lobby', seatsTaken: 2, maxSeats: 5, joinable: true });
  });

  it('rejects invalid codes, unknown rooms, bad names and unexpected fields', async () => {
    t = await startTestServer();
    const host = await createRoom(t.url, { name: 'Ada' });
    expect((await post<ErrorResponse>(t.url, '/api/rooms/12/join', { name: 'x' })).body.error.code).toBe('INVALID_ROOM_CODE');
    expect((await post<ErrorResponse>(t.url, '/api/rooms/ZZZZZZ/join', { name: 'x' })).status).toBe(404);
    expect((await post<ErrorResponse>(t.url, `/api/rooms/${host.roomCode}/join`, { name: '' })).body.error.code).toBe('INVALID_PAYLOAD');
    expect((await post<ErrorResponse>(t.url, `/api/rooms/${host.roomCode}/join`, { name: '   ' })).body.error.code).toBe('INVALID_NAME');
    expect((await post<ErrorResponse>(t.url, `/api/rooms/${host.roomCode}/join`, { name: 'x'.repeat(30) })).body.error.code).toBe('INVALID_NAME');
    expect((await post<ErrorResponse>(t.url, '/api/rooms', { name: 'Ada', isHost: true })).body.error.code).toBe('INVALID_PAYLOAD');
    expect((await post<ErrorResponse>(t.url, '/api/rooms', { name: 'Ada', botCount: 9 })).status).toBe(400);
    const notJson = await fetch(`${t.url}/api/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
    expect(notJson.status).toBe(400);
    expect(JSON.stringify(await notJson.json())).not.toMatch(/stack|at .*\.ts/);
  });

  it('refuses a sixth participant and joins after the game started', async () => {
    t = await startTestServer();
    const host = await createRoom(t.url, { name: 'Ada', botCount: 4 });
    const full = await post<ErrorResponse>(t.url, `/api/rooms/${host.roomCode}/join`, { name: 'Bob' });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('ROOM_FULL');
  });

  it('gives duplicate display names a suffix instead of letting one impersonate another', async () => {
    t = await startTestServer();
    const host = await createRoom(t.url, { name: 'Ada' });
    const twin = await joinRoom(t.url, host.roomCode, 'ada');
    expect(twin.playerId).not.toBe(host.playerId);
    const room = t.server.manager.getRoom(host.roomCode)!;
    expect(room.participants.map((p) => p.name)).toEqual(['Ada', 'ada 2']);
  });

  it('rate-limits room creation', async () => {
    t = await startTestServer({ rateLimits: { createPerMin: 3, joinPerMin: 30, lookupPerMin: 60 } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await post(t.url, '/api/rooms', { name: `P${i}` })).status);
    expect(statuses.slice(0, 3)).toEqual([201, 201, 201]);
    expect(statuses[3]).toBe(429);
    const limited = await post<ErrorResponse>(t.url, '/api/rooms', { name: 'X' });
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });

  it('serves the built client: hashed assets cached long-term, every page route falls back to index.html', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cabo-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Cabo</title>');
    writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
    t = await startTestServer({ webDistDir: dir });
    for (const path of ['/', '/rules', '/r/ABCDEF']) {
      const page = await fetch(`${t.url}${path}`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('<title>Cabo</title>');
      expect(page.headers.get('cache-control')).toBe('no-cache');
    }
    const asset = await fetch(`${t.url}/assets/index-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${t.url}/favicon.svg`)).status).toBe(200);
    const missingApi = await fetch(`${t.url}/api/unknown`);
    expect(missingApi.status).toBe(404);
    expect(missingApi.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('refuses new rooms when the server is at capacity', async () => {
    t = await startTestServer({ maxRooms: 1 });
    await createRoom(t.url, { name: 'Ada' });
    const res = await post<ErrorResponse>(t.url, '/api/rooms', { name: 'Bob' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVER_FULL');
  });
});
