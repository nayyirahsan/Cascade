import type { Message, MessageId, NodeId } from './types';

export const BASE_BACKOFF_MS = 50;
export const MAX_BACKOFF_MS = 2000;
export const PROPAGATION_DELAY_MS = 10;

export function createMessage(
  id: MessageId,
  sourceId: NodeId,
  targetId: NodeId,
  createdAt: number,
  retryCount = 0,
): Message {
  return {
    id,
    sourceId,
    targetId,
    retryCount,
    createdAt,
    status: 'IN_FLIGHT',
  };
}

export function computeBackoffMs(retryCount: number, jitter: number): number {
  const base = Math.min(BASE_BACKOFF_MS * 2 ** retryCount, MAX_BACKOFF_MS);
  return base * (0.5 + 0.5 * jitter);
}
