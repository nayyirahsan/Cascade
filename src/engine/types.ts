export type NodeId = string;
export type MessageId = string;

export type NodeType = 'LoadBalancer' | 'Service' | 'Database';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface NodeConfig {
  retryBudget: number;
  timeoutMs: number;
  concurrencyLimit: number;
  queueDepth: number;
  cbFailureThreshold: number;
  cbRecoveryTimeoutMs: number;
}

export interface NodeState {
  id: NodeId;
  type: NodeType;
  config: NodeConfig;
  circuit: CircuitState;
  consecutiveFailures: number;
  circuitOpenedAt: number;
  inFlight: number;
  queuedCount: number;
  stats: {
    sent: number;
    succeeded: number;
    failed: number;
    retried: number;
    rejected: number;
  };
}

export type EventType =
  | 'MESSAGE_SEND'
  | 'MESSAGE_ARRIVE'
  | 'MESSAGE_TIMEOUT'
  | 'RETRY_SCHEDULED'
  | 'CIRCUIT_PROBE'
  | 'FAULT_INJECT'
  | 'FAULT_CLEAR';

export interface SimEvent {
  id: string;
  /** Monotonic insertion sequence; breaks virtualTime ties deterministically (FIFO). */
  seq: number;
  type: EventType;
  virtualTime: number;
  payload: Record<string, unknown>;
}

export interface Message {
  id: MessageId;
  sourceId: NodeId;
  targetId: NodeId;
  retryCount: number;
  createdAt: number;
  status: 'IN_FLIGHT' | 'DELIVERED' | 'FAILED' | 'RETRYING';
}

export interface SimulationState {
  virtualTime: number;
  nodes: Map<NodeId, NodeState>;
  edges: Array<{ source: NodeId; target: NodeId }>;
  messages: Map<MessageId, Message>;
  events: SimEvent[];
  faults: Map<NodeId, 'FAILED' | 'SLOW'>;
  isRunning: boolean;
  seed: number;
}

export interface NodeDefinition {
  id: NodeId;
  type: NodeType;
  config: NodeConfig;
  requestsPerSecond?: number;
}

export interface FaultDefinition {
  nodeId?: NodeId;
  edge?: { source: NodeId; target: NodeId };
  type: 'FAILED' | 'SLOW' | 'PARTITION';
  injectAt: number;
  clearAt?: number;
  latencyMs?: number;
}

export interface TopologyInput {
  nodes: NodeDefinition[];
  edges: Array<{ source: NodeId; target: NodeId }>;
  faults?: FaultDefinition[];
  maxVirtualTime?: number;
}

export interface LoadBalancerMeta {
  requestsPerSecond: number;
  roundRobinIndex: number;
}

export type FaultType = 'FAILED' | 'SLOW';

export interface SlowFaultDetail {
  type: 'SLOW';
  latencyMs: number;
}
