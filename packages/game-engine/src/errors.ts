import type { ErrorCode } from '@cabo/shared';

/** The subset of error codes the rules engine can produce. */
export type EngineErrorCode = Extract<
  ErrorCode,
  'NOT_YOUR_TURN' | 'WRONG_PHASE' | 'ILLEGAL_ACTION' | 'INVALID_TARGET' | 'ALREADY_DONE'
>;

export interface EngineError {
  code: EngineErrorCode;
  /** Developer-facing detail for logs and tests. Never contains card values. */
  detail: string;
}

export class EngineRejection extends Error {
  constructor(
    readonly code: EngineErrorCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
    this.name = 'EngineRejection';
  }
}

export function reject(code: EngineErrorCode, detail: string): never {
  throw new EngineRejection(code, detail);
}
