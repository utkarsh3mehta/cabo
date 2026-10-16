import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SLOT_INDICES, eventsVisibleTo, type GameMode, type PlayerId, type RoutedEvent } from '@cabo/shared';
import {
  applyAction,
  createGame,
  createSeededRng,
  getPlayerView,
  playersToAct,
  startNextRound,
  type GameState,
} from '@cabo/game-engine';
import { describe, expect, it } from 'vitest';
import { BotMemory, decideAction } from '../src/index.js';

function route(events: RoutedEvent[], memories: Map<PlayerId, BotMemory>) {
  for (const [p, m] of memories) for (const e of eventsVisibleTo(events, p)) m.observe(e);
}

/** Every value a bot remembers must match the real card at that position. */
function assertMemoryAccurate(state: GameState, memory: BotMemory) {
  if (state.round.phase === 'complete') return;
  for (const p of state.players) {
    for (const slot of SLOT_INDICES) {
      const remembered = memory.get(p, slot);
      if (remembered === undefined) continue;
      const card = state.round.hands[p]?.[slot];
      expect(card, `bot ${memory.self} remembers ${p}:${slot}`).toBeTruthy();
      expect(card?.value).toBe(remembered);
    }
  }
}

function simulate(seed: number, n: number, mode: GameMode) {
  const players = ['b1', 'b2', 'b3', 'b4', 'b5'].slice(0, n);
  const rng = createSeededRng(`bots-${seed}`);
  const created = createGame({ players, mode }, { rng });
  let state = created.state;
  const memories = new Map(players.map((p) => [p, new BotMemory(p)]));
  route(created.events, memories);
  let actions = 0;
  let knowledgeOfOpponents = 0;
  while (state.phase !== 'gameComplete') {
    if (state.phase === 'roundComplete') {
      const next = startNextRound(state, { rng });
      if (!next.ok) throw new Error('next round failed');
      state = next.state;
      route(next.events, memories);
      continue;
    }
    const actors = playersToAct(state);
    const actor = actors[rng.int(actors.length)] as PlayerId;
    const memory = memories.get(actor) as BotMemory;
    const view = getPlayerView(state, actor);
    const action = decideAction(view, memory, rng);
    if (!action) throw new Error(`bot ${actor} had no action`);
    const result = applyAction(state, actor, action, { rng });
    if (!result.ok) throw new Error(`bot chose illegal ${JSON.stringify(action)}: ${result.error.code} ${result.error.detail}`);
    state = result.state;
    route(result.events, memories);
    for (const m of memories.values()) {
      assertMemoryAccurate(state, m);
      for (const p of players) if (p !== m.self) for (const s of SLOT_INDICES) if (m.get(p, s) !== undefined) knowledgeOfOpponents++;
    }
    actions++;
    if (actions > 50_000) throw new Error('bot game did not finish');
  }
  return { state, actions, knowledgeOfOpponents };
}

describe('easy bots', () => {
  it('play complete full games using only legal actions', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const n = 2 + (seed % 4);
      const { state } = simulate(seed, n, 'full');
      expect(state.result?.winners.length).toBeGreaterThan(0);
      expect(state.players.some((p) => (state.scores[p]?.total ?? 0) > 100)).toBe(true);
    }
  });

  it('play complete quick games', () => {
    for (let seed = 100; seed < 110; seed++) {
      const { state } = simulate(seed, 2 + (seed % 4), 'quick');
      expect(state.roundResults.length).toBeLessThanOrEqual(3);
    }
  });

  it('only remember opponent cards they legitimately learned, and remember them correctly', () => {
    // Memory accuracy is asserted after every action inside simulate(); here we
    // also check that bots do learn something through Spy and public reveals.
    const { knowledgeOfOpponents } = simulate(7, 4, 'full');
    expect(knowledgeOfOpponents).toBeGreaterThan(0);
  });

  it('are not deterministic across seeds', () => {
    const a = simulate(1, 3, 'quick');
    const b = simulate(2, 3, 'quick');
    expect(a.actions === b.actions && JSON.stringify(a.state.scores) === JSON.stringify(b.state.scores)).toBe(false);
  });

  it('treat unknown cards as unknown', () => {
    const rng = createSeededRng('unknown');
    const { state } = createGame({ players: ['x', 'y'], mode: 'full' }, { rng });
    const memory = new BotMemory('x');
    memory.syncWithView(getPlayerView(state, 'x'));
    expect(memory.knownCount()).toBe(0);
  });

  it('do nothing when it is not their turn', () => {
    const rng = createSeededRng('idle');
    let { state } = createGame({ players: ['x', 'y'], mode: 'full' }, { rng });
    for (const p of ['x', 'y']) {
      const m = new BotMemory(p);
      for (let i = 0; i < 2; i++) {
        const a = decideAction(getPlayerView(state, p), m, rng);
        const r = applyAction(state, p, a!, { rng });
        if (!r.ok) throw new Error('inspection failed');
        state = r.state;
      }
    }
    const idle = state.players.find((p) => p !== state.round.currentPlayer)!;
    expect(decideAction(getPlayerView(state, idle), new BotMemory(idle), rng)).toBeNull();
  });
});

describe('information boundary', () => {
  it('bot source code never imports the game engine or internal state', () => {
    const dir = join(import.meta.dirname, '..', 'src');
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), 'utf8');
      expect(source, file).not.toMatch(/game-engine/);
      expect(source, file).not.toMatch(/GameState|drawPile|hands\[/);
    }
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual(['@cabo/shared']);
  });
});
