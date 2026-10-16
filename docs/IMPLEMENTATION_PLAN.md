# Cabo Online — Implementation Plan and Status

Status legend: ☐ not started · ◐ partly done · ☑ done and verified by running it

## Environment (inspected 2026-10-16)

- The project directory was empty. It was initialised as a git repository.
- Node.js 24.14, npm 11, pnpm 12.14 via Corepack, Docker 29.6, Windows 11 host.
- Decision: a pnpm workspace monorepo, as suggested. Library lines were chosen
  for stability: TypeScript 5.9, Vite 7, Vitest 4.1, React 19, react-router 7,
  Fastify 5, Socket.IO 4.8, Zod 4, Playwright 1.64.

## Milestone 1 — Research and architecture ☑
- ☑ Read the publisher's current standard rules and product page
  (cabogame.com, Shareful Games 2025) and their printed rules card.
- ☑ Cross-checked the 2019 2nd edition (comparison only) and the original 2010
  rules (licensee PDF).
- ☑ Settled the deck inventory and ability mapping from a German short-rules
  sheet for the licensed edition, Wikipedia and an implementation. The
  remaining gap is in RULES_SPECIFICATION §13.
- ☑ `docs/RULES_SPECIFICATION.md`, `docs/ARCHITECTURE.md`, this plan.

## Milestone 2 — Core game engine ☑
- ☑ Card model, verified inventory, ability mapping (`packages/shared/src/cards.ts`).
- ☑ Seeded RNG for tests, crypto RNG in production, Fisher–Yates shuffle.
- ☑ Setup, inspection, all turn actions, abilities, matching (success and
  failure), Cabo and final turns, reshuffle.
- ☑ Pure scoring, Moon, penalty, ties, reset, full and quick endings, next
  starter.
- ☑ `getPlayerView`, `getLegalActions`, `checkInvariants`.
- ☑ Verified by 58 engine tests, including fast-check playouts of 40 random
  complete games per run with invariant and leak checks after every step.

## Milestone 3 — Authoritative multiplayer server ☑
- ☑ Configuration, Fastify app, `/healthz`, `/readyz`, security headers, static
  client.
- ☑ Hashed session tokens, room codes, RoomManager with TTL sweeping.
- ☑ HTTP create, join and lookup with rate limits.
- ☑ Socket.IO auth, origin check, per-IP caps, per-socket token bucket,
  synchronous command handling, idempotency, versioning.
- ☑ Personalised snapshots and routed events.
- ☑ Verified by 43 integration tests with real socket clients (repeated three
  times, no flakes).

## Milestone 4 — Responsive web client ☑
- ☑ Original visual system, card faces and backs, and icons.
- ☑ Home (solo, create, join, rejoin), name entry, invitation route, rules page.
- ☑ Lobby: code, copyable link, seats, host controls, bots, mode.
- ☑ Table: 2 × 2 grids, opponents, piles, held card, guided move flow,
  inspection, peek and spy panel, Cabo confirmation, turn order, scores,
  recent moves.
- ☑ Round results with a leader line, game-over screen, play again, home.
- ☑ Accessibility: labelled card buttons, `aria-pressed` selections, focus
  rings, `role=alert` error toasts, text labels next to colour.
- ☑ Verified with screenshots at 375 px and 1280 px, Playwright mobile and
  desktop runs, and zero horizontal overflow on every screen.

## Milestone 5 — Bots and recovery ☑
- ☑ `packages/bots`: slot memory and an easy strategy using only views and
  events. Measured over 60 bot-only games: about 18 turns per round, 70% of
  Cabo calls successful, no illegal moves.
- ☑ BotRunner with bounded random delays. Bots act only after a commit.
- ☑ Reconnection, host transfer, bot takeover with memory replay, next-round
  readiness, leave.

## Milestone 6 — End-to-end verification ☑
- ☑ 8 Playwright scenarios × 2 device profiles = 16 browser tests, all
  passing, run repeatedly. They also pass against the hardened Docker container.
- ☑ Defects found and fixed along the way: an engine crash on structurally
  invalid input, a `leave` acknowledgement lost to a synchronous disconnect, a
  static route collision in production, a Caddy start failure with an empty
  e-mail, and badge overlap on mini cards.

## Milestone 7 — Deployment and handover ☑
- ☑ Multi-stage Dockerfile (non-root, read-only filesystem), `compose.yaml`
  with Caddy, `deploy/Caddyfile`, `.env.example`.
- ☑ Image built and run locally. The full browser suite passed against the
  container. The Compose stack with Caddy served HTTPS and WSS locally (Caddy
  internal CA) and passed the multiplayer and refresh browser tests.
- ☑ README and `docs/DEPLOYMENT.md`.
- ◐ Real Let's Encrypt issuance on a public domain could not be exercised from
  this environment.

## Test plan (as implemented)

| Layer | Tool | Count | Scope |
|-------|------|------:|-------|
| Shared | Vitest | 11 | Inventory, ability map, name and code normalisation, schema strictness |
| Engine | Vitest + fast-check | 58 | Rules, scoring fixtures, boundaries, lifecycle, views, invariants, malformed input |
| Bots | Vitest | 7 | Legal full games, memory accuracy, information boundary |
| Web | Vitest | 3 | The activity log never shows private values; changed-slot markers |
| Server | Vitest + socket.io-client | 43 | HTTP, auth, lobby, security, concurrency, full games, recovery, cleanup |
| Browser | Playwright (desktop + Pixel 7) | 16 | The required user journeys |
