export { BotMemory } from './memory.js';
export { UNKNOWN_CARD_ESTIMATE, decideAction, fallbackAction, type BotRng } from './strategy.js';

/** Default bot display names; the UI marks bots separately. */
export const BOT_NAMES = ['Pip', 'Juno', 'Basil', 'Mabel', 'Otto', 'Hazel', 'Rex', 'Ivy'] as const;
