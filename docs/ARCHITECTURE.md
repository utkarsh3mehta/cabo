# Cabo Online — Architecture

## 1. Overview

Cabo Online is a server-authoritative, real-time multiplayer card game. A
single Node.js process serves the built React client, a small HTTP API and a
Socket.IO endpoint. All game state lives in that process's memory.

```
 Browser (React SPA)                       Node.js process (apps/server)
 ┌──────────────────────┐   HTTPS   ┌───────────────────────────────────────────┐
 │ pages / components   │──────────▶│ Fastify: /api/rooms, /healthz, /readyz,   │
 │ useRoomConnection()  │           │          static SPA                       │
 │   socket.io-client   │◀═════════▶│ Socket.IO: commands ⇄ personalised views  │
 └──────────────────────┘    WSS    │   RoomManager ─▶ Room (per-room queue)    │
                                    │        │            │                     │
                                    │        ▼            ▼                     │
                                    │  @cabo/game-engine   BotRunner ─▶ @cabo/bots│
                                    │  (pure rules)        (PlayerView only)    │
                                    └───────────────────────────────────────────┘
```

In production, Caddy sits in front for TLS and proxies HTTP and WebSocket
traffic to the app container.

## 2. Repository layout

| Path | Package | Depends on | Purpose |
|------|---------|------------|---------|
| `packages/shared` | `@cabo/shared` | `zod` | Card inventory, IDs, client action schemas, player-view and event types, socket protocol, error codes, input limits. `@cabo/shared/client` is a Zod-free entry point for the browser bundle. |
| `packages/game-engine` | `@cabo/game-engine` | `@cabo/shared` | Pure rules engine: state, transitions, scoring, player-view projection, invariants. No I/O, timers, sockets or React. |
| `packages/bots` | `@cabo/bots` | `@cabo/shared` | Easy bot: memory and decision making from `PlayerView` plus visible events. **It cannot import the engine**, so it cannot see internal state. |
| `apps/server` | `@cabo/server` | all packages | Fastify, Socket.IO, rooms, sessions, rate limiting, bot scheduling, cleanup |
| `apps/web` | `@cabo/web` | `@cabo/shared` | React + Vite single-page app |

Workspace packages export their TypeScript sources ("internal packages"). Vite
compiles them for the web app. `tsup` bundles them into the server build. Vitest
runs them directly. Dependencies only point "down" (apps → packages,
engine/bots → shared), so there are no cycles.

## 3. Game engine

### 3.1 State model

```
GameState
  config        { mode: 'full' | 'quick' }
  players       PlayerId[]                   seat order = clockwise turn order
  scores        Record<PlayerId, { total, resetUsed, roundWins }>
  history       RoundResult[]
  phase         'round' | 'roundComplete' | 'gameComplete'
  round         RoundState
  result        GameResult | null            set when phase = gameComplete

RoundState
  number, startingPlayer
  phase         'initialInspection' | 'turns'
  drawPile      Card[]                       top = last element
  discardPile   Card[]                       top = last element
  hands         Record<PlayerId, (Card | null)[4]>   null = empty slot after a match
  inspection    Record<PlayerId, { peeked: SlotIndex[] | null, done: boolean }>
  turn          { player, step: TurnStep }
  caboCaller    PlayerId | null
  finalTurnsRemaining  number | null

TurnStep (discriminated union)
  { kind: 'awaitingAction' }
  { kind: 'holding', card, source: 'deck' | 'discard' }
  { kind: 'viewing', ability: 'peek' | 'spy', target: { player, slot } }
```

`Card = { id, value }`. IDs are unique within a game and used for accounting.
**They never leave the server** (§4).

### 3.2 Transitions

`applyAction(state, playerId, action, { rng }) → { ok: true, state, events } | { ok: false, error }`

- The function is pure with respect to `state`. It works on a structured
  clone and returns the new state, so a rejected action leaves the caller's
  state untouched and every accepted action is fully committed.
- Every action is checked against the current phase, step, turn owner, slot
  occupancy and targets before anything changes. The engine also re-parses
  the action with the shared Zod schema, so malformed input is rejected even
  if a caller skips validation.
- Randomness (dealing, reshuffles, round-1 starter) goes through an injected
  `Rng`. Production uses `crypto.randomInt`. Tests use a seeded PRNG.

Main entry points:

| Function | Responsibility |
|----------|----------------|
| `createGame(players, config, rng)` | New game, deal round 1 |
| `startRound` (internal) | Shuffle, deal 4 each, flip discard, pick starter |
| `applyAction` | Dispatch: `inspect`, `finishInspection`, `drawFromDeck`, `takeDiscard`, `callCabo`, `replace`, `match`, `discardDrawn`, `usePeek`, `useSpy`, `useSwap`, `acknowledgeReveal` |
| `scoreRound(hands, caller)` | Pure round scoring (§7 of the rules spec) |
| `applyRoundToTotals` | Cumulative scores, 100→50 reset, quick-game round wins |
| `evaluateGameEnd` | Full/quick end conditions, winners |
| `startNextRound(state, rng)` | Next starter, new deal |
| `getPlayerView(state, viewer)` | Per-player projection (§4) |
| `getLegalActions(state, viewer)` | What the viewer may do now |
| `checkInvariants(state)` | Card accounting: 52 unique IDs, each in exactly one place |

### 3.3 Events

Each transition also returns `RoutedEvent[]`, where every event has an
audience: `'all'` or a single `PlayerId`. Examples: `drewFromDeck` (all, no
value), `drawnCard` (drawer only, with value), `replaced` (all, with the
discarded value and, for discard-pile takes, the placed value), `peekResult`
(actor only), `swapped` (all, positions only), `matchFailed` (all, revealed
values), `roundEnded` (all, every hand revealed).

## 4. Hidden information

This is a memory game, so hidden information is a core part of the design.

1. **One projection function.** Every snapshot a client or bot receives is
   produced by `getPlayerView(state, viewer)`. The server never serialises
   `GameState` to a socket, HTTP response or log.
2. **Face-down cards carry no identity.** A slot in a view is
   `{ index, occupied, value? }`. Card IDs are never sent, so clients cannot
   follow a card through a reshuffle or into the next round.
3. **Values appear only with entitlement:**
   - your own two inspected slots, during initial inspection, until you finish;
   - the slot you are peeking or spying, until you acknowledge;
   - the card you hold after drawing from the deck (others only see that you
     hold a deck card);
   - the discard pile top, discard-taken cards while held, cards revealed by a
     match attempt (via events), and every hand once the round is scored.
4. **Events are routed.** The server delivers each event only to sockets in its
   audience. Private events are never broadcast.
5. **Bots use the same projection.** The bot runner calls
   `getPlayerView(state, botId)` and passes the bot only its routed events.
   `@cabo/bots` does not depend on `@cabo/game-engine`, so bot code cannot
   reach internal state.
6. **No disclosure through side channels.** Error messages are fixed strings
   keyed by error code. Logs record room codes, player IDs and action types,
   never tokens or card values. The client does not store card values in
   `localStorage`.
7. **Clients cannot claim an identity.** The acting player is always the
   player bound to the authenticated socket. Payloads contain no "actor"
   field, and the schemas are `strict`, so unknown keys are rejected.

## 5. Rooms, identity and sessions

### 5.1 Lifecycle

```
lobby ──startGame──▶ playing ──(game complete)──▶ finished ──returnToLobby──▶ lobby
  │                     │                             │
  └──── idle TTL ───────┴──── abandoned TTL ──────────┴── finished TTL ──▶ deleted
```

- **Create**: `POST /api/rooms` → room code + `playerId` + session token. The
  creator is host.
- **Join**: `POST /api/rooms/:code/join` (lobby only, with a free seat).
- **Solo**: create with `botCount` 1–4. The room is created with bots seated
  and bots allowed, and the client starts the game straight away.
- **Start**: host only, 2–5 participants, bots counted.

### 5.2 Room codes and tokens

- Room codes are 6 characters from a 31-character unambiguous alphabet
  (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`, about 8.9 × 10⁸ codes), drawn with
  `crypto.randomInt` and checked for collisions. Codes only let you **join**.
  They never identify you.
- Invitation URL: `${PUBLIC_URL}/r/${code}`.
- The session token is 32 random bytes (base64url). The server keeps only its
  SHA-256 hash, mapped to `(roomCode, playerId)`. The client keeps the token
  in `localStorage` (per room) so a refresh or reopened tab can reconnect.
- The socket handshake carries the token (`auth.token`). Without a valid token
  there is no room access. A display name can never claim a seat.
- One live socket per seat. A newer connection with the same token replaces
  the older one, which is told and then disconnected.
- The identity layer (`SessionStore`) is separate from the engine, so real
  accounts could later issue the same `(roomCode, playerId)` binding.

### 5.3 Command processing

- Every state-changing socket command carries a client-generated `actionId`
  (UUID) and is validated with Zod before it reaches the room.
- Room command handling is fully synchronous (validate → pure transition →
  commit → broadcast, with no `await` in between). On Node's single thread,
  each command and each bot move therefore runs to completion before the next
  one starts, so concurrent commands from different sockets cannot interleave.
- **Idempotency**: each room remembers the last 64 `actionId`s per player and
  their results. A retried command returns the original result and is not
  applied again.
- **Versioning**: every committed change increments `room.version`. Game
  commands may include `expectedVersion`. A mismatch is rejected with
  `STALE_VERSION` and the client resyncs. Every snapshot includes the version.
- After each commit, every connected socket in the room gets a fresh
  personalised `RoomView` and its routed events. Clients ignore snapshots
  older than the newest version they have seen. The web client retries a
  timed-out command with the **same** `actionId`, so retries are safe. It does
  not send `expectedVersion`, because the engine re-validates every move and
  unrelated updates (such as a bot finishing its inspection) would otherwise
  cause spurious rejections. The server feature exists and is tested.

### 5.4 Disconnection, reconnection and bot takeover

- On disconnect the seat stays reserved and the participant shows as
  disconnected. The game does not skip their turns.
- Reconnecting with the token within any period restores the seat. The client
  gets the current `RoomView`, including any private information it is still
  entitled to (an unfinished initial inspection or an unacknowledged peek or
  spy). Consumed actions are not replayed.
- After `RECONNECT_GRACE_MS` (default 60 s), if the room allows bots, the host
  may **replace the player with a bot**. This is a server transition:
  - the seat keeps its ID, position, cards and scores;
  - the seat's token stays known to the server, but it can no longer attach
    to the seat. A returning player's connection is refused with
    `SEAT_TAKEN_OVER`, and the client says clearly that the seat was handed to
    a bot;
  - the new bot rebuilds its memory by replaying only the events that seat
    was entitled to see this round;
  - **the takeover is permanent for the rest of the game.** Two occupants can
    never hold one seat. When the host returns the room to the lobby, taken-over
    seats are removed.
- **Leaving** with the Leave button revokes the token. In the lobby the seat
  is freed. During a game the seat stays, counts as past its grace period, and
  can be handed to a bot straight away. When every human has left, the room
  closes.
- **Host policy**: a host who reconnects within the grace period stays host.
  Once the host has been disconnected longer than the grace period, the host
  role passes to the connected human with the lowest seat index. A former
  host does not automatically reclaim the role, which avoids mid-game
  flip-flops. If no connected human holds the host role (for example,
  everyone else has left), the first human to reconnect becomes host.

### 5.5 Next round

After a round is scored, each connected human confirms "Next round".
Disconnected humans and bots never block. When every connected human is ready,
the server starts the next round.

### 5.6 Cleanup (in-memory TTLs)

| Situation | Default | Variable |
|-----------|---------|----------|
| Reconnect grace (seat reserved before host actions) | 60 s | `RECONNECT_GRACE_MS` |
| Room with no connected humans (lobby or game) | 15 min | `ROOM_IDLE_TTL_MS` |
| Finished room kept for viewing or a rematch | 30 min | `FINISHED_ROOM_TTL_MS` |
| Absolute room lifetime | 12 h | `ROOM_MAX_AGE_MS` |
| Sweep interval | 30 s | — |
| Max concurrent rooms | 1000 | `MAX_ROOMS` |

Deleting a room deletes its sessions too.

**Restart behaviour:** all rooms and sessions live in memory. A process restart
or redeploy ends every active game. Clients then see "room not found" and
return to the home screen.

## 6. Protocol

### 6.1 HTTP

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/healthz` | — | `{ status: "ok" }` (liveness) |
| GET | `/readyz` | — | `{ status: "ready" }` once listening, `503` while shutting down |
| POST | `/api/rooms` | `{ name, mode, allowBots, botCount? }` | `{ roomCode, playerId, token }` |
| POST | `/api/rooms/:code/join` | `{ name }` | `{ roomCode, playerId, token }` |
| GET | `/api/rooms/:code` | — | `{ code, phase, seatsTaken, maxSeats, joinable }` |

### 6.2 Socket.IO

Client → server (every command has an ack `{ ok: true, version } | { ok: false, error: { code, message } }`):

| Event | Payload |
|-------|---------|
| `room:sync` | `{}` (ask for a fresh snapshot) |
| `room:command` | `{ actionId, command }`, where `command` is one of `setName`, `updateSettings`, `addBot`, `removeBot`, `startGame`, `game { action, expectedVersion? }`, `readyNextRound`, `replaceWithBot`, `returnToLobby`, `leave` |

Game `action` is one of `inspect { slots: [a, b] }`, `finishInspection`,
`drawFromDeck`, `takeDiscard`, `callCabo`, `replace { slot }`,
`match { slots }`, `discardDrawn`, `usePeek { slot }`,
`useSpy { target: { playerId, slot } }`,
`useSwap { ownSlot, target: { playerId, slot } }`, `acknowledgeReveal`.

Server → client:

| Event | Payload |
|-------|---------|
| `room:snapshot` | `RoomView`, personalised, versioned |
| `game:events` | `VisibleEvent[]`, only the recipient's audience |
| `session:ended` | `{ reason: 'seatTakenOver' | 'roomClosed' | 'replacedByNewConnection' | 'left' }` |

Error codes are listed in `packages/shared/src/errors.ts`, each with a fixed,
safe message.

## 7. Bots

- `@cabo/bots` exports `BotMemory` and `decideAction(view, memory, rng)`.
- **Memory** is slot-based (`playerId:slot → value`). It is updated from
  routed events: its own initial peek, peek and spy results, the deck card it
  drew, public discards, discard-pile placements, match reveals, and swap or
  replace movements, which move or clear entries. Unknown cards stay unknown.
- **Strategy** (easy): estimate its own total, using the mean of unseen values
  for unknown slots. Take a low discard. Replace its highest known or unknown
  card with low draws. Use Peek on its own unknown slots and sometimes Spy. Swap
  a known high card for a known low opponent card. Match groups it knows
  match. Call Cabo when its estimated total is low enough (with a randomised
  threshold). Small random choices keep games from repeating.
- **Timing**: the `BotRunner` acts only after the previous transition has
  committed and broadcast. It waits a random 700–1500 ms (configurable), then
  checks the room version is unchanged before submitting through the same
  command path as humans. If the engine rejects a bot action (which would be a
  bug), the runner logs it and falls back to the simplest legal action, so the
  game never stalls.

## 8. Abuse prevention and operational security

- Zod validation on every HTTP body and socket payload. Strict objects, bounded
  strings and arrays.
- Display names: trimmed, 1–20 characters, control characters rejected, Unicode
  normalised. Rendered as text only, never as HTML.
- Rate limits: room creation 10/min/IP, join 30/min/IP, room lookup 60/min/IP
  (`@fastify/rate-limit`). Socket commands use a per-socket token bucket
  (burst 40, 15/s). Concurrent sockets are capped per IP.
- Payload caps: HTTP body 8 KB, Socket.IO message 16 KB.
- CORS and Socket.IO origin are restricted to `PUBLIC_ORIGIN`. Security headers
  (CSP, frame-ancestors, nosniff) come from `@fastify/helmet`.
- `trustProxy` is configurable so client IPs are correct behind Caddy.
- Logs use pino with redaction of `authorization`, `token` and `cookie`
  fields. Error responses never include stack traces.
- Unhandled errors inside a room command are caught, logged without state, and
  returned as `INTERNAL_ERROR`. The room's state stays as it was.

**Not provided:** this is a single-process, in-memory service for a small
audience. There is no horizontal scaling, no persistent abuse tracking, no
CAPTCHA and no DDoS protection beyond the rate limits above. Place it behind a
CDN or WAF if that matters.

## 9. Frontend

- React 19 + Vite + TypeScript, `react-router` for `/`, `/rules`, `/r/:code`.
- `useRoomConnection(code)` owns the socket. It authenticates with the stored
  token, applies snapshots (dropping any older than the latest version),
  collects events for the activity line, retries commands with the same
  `actionId`, and exposes typed command senders.
- The table UI is split into focused components: `PlayerLayout` (2 × 2 slot
  grid), `Piles`, `ActionPanel` (only legal controls), `TurnBanner`,
  `ScoreStrip`, `RoundResults`, `GameOver`, `Lobby`.
- Multi-step moves (replace, match, ability targets) are a small client-side
  selection state machine (`apps/web/src/game/interaction.ts`). It resets
  whenever the server moves the player to a new decision point. Every step
  tells the player what to do next, and the server re-validates everything.
- The "Recent moves" list shows only the last six public moves. It never
  includes private values (a drawn, peeked or spied card), so it cannot act as
  a memory aid beyond what the table showed at the time. A static marker
  highlights the slots touched by the most recent turn.
- Calling Cabo takes a confirmation click, so it cannot be triggered by
  accident.
- No animations or sounds. State changes are shown with static highlights and
  text. Errors go to an `aria-live` region.

## 10. Deployment

- One multi-stage `Dockerfile` builds the web app and the server. It produces a
  `node:24.14.1-alpine3.23` runtime image (about 270 MB uncompressed) that runs
  as the unprivileged `node` user with only the bundled server, the static
  client and production dependencies (`pnpm deploy --prod`).
- The server serves the built client with `@fastify/static`. Hashed
  `/assets/*` are cached as immutable. Any other GET page route returns
  `index.html`, so invitation links like `/r/K7M2P9` work on direct
  navigation.
- `compose.yaml` runs `app` (not published to the host; read-only root
  filesystem, all capabilities dropped, `no-new-privileges`) and `caddy`
  (ports 80/443, automatic HTTPS, WebSocket proxying). Only Caddy's
  certificate store is a persistent volume. No game state is persisted.
- See `docs/DEPLOYMENT.md` for the operator guide.
- Configuration comes from environment variables (`.env.example`).
