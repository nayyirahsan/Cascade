import type { NodeConfig, NodeId, NodeState, NodeType } from './types';

export const DEFAULT_CONFIGS: Record<NodeType, NodeConfig> = {
  LoadBalancer: {
    retryBudget: 0,
    timeoutMs: 500,
    concurrencyLimit: 100,
    queueDepth: 0,
    cbFailureThreshold: 5,
    cbRecoveryTimeoutMs: 1000,
  },
  Service: {
    retryBudget: 3,
    timeoutMs: 300,
    concurrencyLimit: 10,
    queueDepth: 20,
    cbFailureThreshold: 5,
    cbRecoveryTimeoutMs: 1000,
  },
  Database: {
    retryBudget: 0,
    timeoutMs: 500,
    concurrencyLimit: 5,
    queueDepth: 10,
    cbFailureThreshold: 3,
    cbRecoveryTimeoutMs: 2000,
  },
};

export function createNodeState(id: NodeId, type: NodeType, config?: Partial<NodeConfig>): NodeState {
  return {
    id,
    type,
    config: { ...DEFAULT_CONFIGS[type], ...config },
    circuit: 'CLOSED',
    consecutiveFailures: 0,
    circuitOpenedAt: 0,
    inFlight: 0,
    queuedCount: 0,
    stats: { sent: 0, succeeded: 0, failed: 0, retried: 0, rejected: 0 },
  };
}

export function processingTimeMs(type: NodeType): number {
  switch (type) {
    case 'LoadBalancer':
      return 5;
    case 'Service':
      return 20;
    case 'Database':
      return 40;
    default:
      return 20;
  }
}
