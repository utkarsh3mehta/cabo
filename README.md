# Cabo Online

A browser-based, real-time multiplayer version of the **Cabo** memory card
game. Play remotely with friends in private rooms (code or invitation link),
or solo against easy bots. No accounts, no installation.

> Unofficial fan implementation. It is not affiliated with or endorsed by the
> publisher. All artwork and text are original.

## Features

- Private rooms for 2–5 participants (bots count toward the limit), joined by
  a 6-character code or an invitation link.
- Solo games against 1–4 easy bots.
- Full game (to 100 points, the default) and quick game (best of three rounds).
- The current publisher's standard rules: choice cards (Peek, Spy, Swap),
  2–4-card matching with the failed-match procedure, Cabo calls with final
  turns, +5 failed-call penalty, tie rules, Shooting the Moon, one-time
  100 → 50 reset, draw-pile reshuffling. See
  [docs/RULES_SPECIFICATION.md](docs/RULES_SPECIFICATION.md).
- A server-authoritative engine. Every client and bot only ever receives a
  per-player projection of the state, so hidden cards never reach a browser
  that is not entitled to them.
- Reconnection after refreshes and network drops. Host transfer. The host can
  hand a disconnected player's seat to a bot.
- A responsive, keyboard-accessible UI for phones and desktops, with no
  animations or sounds.
- Docker and Caddy deployment with automatic HTTPS.

## Repository layout

```
apps/server            Node.js server: Fastify HTTP API, Socket.IO, rooms, sessions, bots runner
apps/web               React + Vite client
packages/shared        Card inventory, schemas, protocol and view types (Zod-free entry: /client)
packages/game-engine   Pure rules engine (no I/O): transitions, scoring, player views, invariants
packages/bots          Easy bot strategy; depends only on @cabo/shared, never on engine internals
e2e                    Playwright browser tests
deploy/Caddyfile       Reverse proxy and TLS
docs/                  Rules specification, architecture, implementation plan, deployment guide
```

## Local development

Requirements: Node.js 22.12+ (24 recommended) and pnpm through Corepack.

```sh
corepack enable          # provides the pinned pnpm version
pnpm install
pnpm dev                 # server on :3000 (tsx watch) + Vite on :5173
```

Open <http://localhost:5173>. To try multiplayer on one machine, use a second
browser profile or a private window for each extra player, because sessions
are stored per browser.

In development `PUBLIC_ORIGIN` is not required, and WebSocket origin checks
are disabled (the server logs a warning).

## Tests

```sh
pnpm typecheck           # strict TypeScript in every package
pnpm test                # unit + integration tests (Vitest)
pnpm exec playwright install chromium   # once, for browser tests
pnpm test:e2e            # builds, starts the production server, runs Playwright (desktop + mobile)
pnpm test:all            # all of the above
```

What they cover:

- **Engine** (`packages/game-engine/test`): deck integrity, deal, inspection,
  every action, abilities, matching, Cabo and final turns, reshuffle, scoring
  fixtures and boundaries, quick and full endings, illegal transitions, and
  property-based random playouts checking card accounting and that no view
  leaks hidden cards.
- **Bots** (`packages/bots/test`): complete bot-only games with legal moves
  only, memory accuracy, and a structural check that bot code cannot import
  the engine.
- **Server** (`apps/server/test`): real Socket.IO clients against a running
  server. Covers rooms, auth, host rules, sanitised snapshots, private
  delivery of peeks, spies and draws, wrong-player and malformed commands,
  duplicates, concurrency, stale versions, complete human and bot games
  verified against the pure scorer, reconnects, host transfer, bot takeover,
  TTL cleanup, rate limits and static serving.
- **Browser** (`e2e/`): create, join by code, join by link, start, inspect,
  synchronised move, tampered-client rejection, solo quick and full games with
  score checks, refresh recovery, bot takeover, and a 360 px mobile layout.

To run the browser tests against an already running deployment, set
`E2E_BASE_URL=https://your-host`. Note that the production rate limits will
throttle the full suite.

## Production build without Docker

```sh
pnpm build
NODE_ENV=production PUBLIC_ORIGIN=https://cabo.example.com PORT=3000 pnpm start
```

The server serves the built client from `apps/web/dist`. Put it behind an
HTTPS reverse proxy that supports WebSockets.

## Docker / VPS deployment (summary)

```sh
cp .env.example .env     # set DOMAIN, PUBLIC_ORIGIN, ACME_EMAIL
docker compose up -d --build
```

This starts the app container (not exposed) behind Caddy on ports 80/443.
Caddy obtains a Let's Encrypt certificate automatically and proxies
WebSockets. The full guide, covering DNS, firewall, TLS, updates, logs,
configuration and troubleshooting, is in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

**Restart behaviour:** game state is in memory only, so restarting or
updating the server ends every active game.

## Known limitations

- **Deck inventory verification.** The per-value counts (two 0s, four each of
  1–12, two 13s) and the 7–8 Peek / 9–10 Spy / 11–12 Swap mapping are
  corroborated by several independent sources, but the current publisher does
  not print them in published text. They should be checked against a physical
  2025 deck ([RULES_SPECIFICATION §13](docs/RULES_SPECIFICATION.md)). A
  correction is a one-file change in `packages/shared/src/cards.ts`.
- **Interpreted rules.** Quick-game scoring ("best of 3 rounds"), tie-breaks
  in final standings (shared win), the next starter when a round has several
  winners, and where the drawn card goes after a successful match are
  documented interpretations, not publisher text.
- **Single process, in memory.** No persistence, no horizontal scaling, and
  games end on restart. Abuse protection is limited to rate limits,
  connection caps, validation and origin checks.
- **Bots** are deliberately easy, and a bot that takes over a seat keeps it
  for the rest of the game.
- No accounts, matchmaking, chat, statistics or spectators (out of scope).

## Documentation

- [docs/RULES_SPECIFICATION.md](docs/RULES_SPECIFICATION.md): selected
  edition, sources, card inventory, rules, resolved edge cases, open points.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): packages, engine, hidden
  information, rooms and sessions, protocol, bots, security.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): operator guide.
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): milestones and
  test plan with verification status.
