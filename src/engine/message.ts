import type { Message, MessageId, NodeId } from './types';

export const BASE_BACKOFF_MS = 50;
export const MAX_BACKOFF_MS = 2000;
export const PROPAGATION_DELAY_MS = 10;

let messageCounter = 0;

export function resetMessageCounter(): void {
  messageCounter = 0;
}

export function createMessageId(): MessageId {
  messageCounter += 1;
  return `msg-${messageCounter}`;
}

export function createMessage(
  sourceId: NodeId,
  targetId: NodeId,
  createdAt: number,
  retryCount = 0,
): Message {
  return {
    id: createMessageId(),
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
