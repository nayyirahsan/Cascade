import type { FaultDefinition, NodeConfig, NodeType } from '../engine/types';

export interface ScenarioNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  config?: Partial<NodeConfig>;
  requestsPerSecond?: number;
}

export interface Scenario {
  name: string;
  seed: number;
  nodes: ScenarioNode[];
  edges: Array<{ source: string; target: string }>;
  faults: FaultDefinition[];
  maxVirtualTime?: number;
}

/** Node card is 200×~170px — keep ≥100px horizontal and ≥180px vertical gaps. */
const NODE_W = 200;
const H_GAP = 100;
const V_GAP = 180;

const baseService = (id: string, x: number, y: number, config?: Partial<NodeConfig>): ScenarioNode => ({
  id,
  type: 'Service',
  position: { x, y },
  config,
});

function chainX(index: number, startX = 60, y = 200) {
  return { x: startX + index * (NODE_W + H_GAP), y };
}

export const scenarios: Scenario[] = [
  {
    name: 'Retry Storm',
    seed: 42,
    maxVirtualTime: 5000,
    nodes: [
      { id: 'lb', type: 'LoadBalancer', position: chainX(0), requestsPerSecond: 20 },
      baseService('serviceA', chainX(1).x, chainX(1).y, { retryBudget: 3, timeoutMs: 400 }),
      baseService('serviceB', chainX(2).x, chainX(2).y, { retryBudget: 0, timeoutMs: 300 }),
    ],
    edges: [
      { source: 'lb', target: 'serviceA' },
      { source: 'serviceA', target: 'serviceB' },
    ],
    faults: [{ nodeId: 'serviceB', type: 'SLOW', injectAt: 200, latencyMs: 500 }],
  },
  {
    name: 'Cascading Failure',
    seed: 7,
    maxVirtualTime: 5000,
    nodes: [
      { id: 'lb', type: 'LoadBalancer', position: chainX(0), requestsPerSecond: 15 },
      baseService('serviceA', chainX(1).x, chainX(1).y),
      baseService('serviceB', chainX(2).x, chainX(2).y),
      { id: 'db', type: 'Database', position: chainX(3) },
    ],
    edges: [
      { source: 'lb', target: 'serviceA' },
      { source: 'serviceA', target: 'serviceB' },
      { source: 'serviceB', target: 'db' },
    ],
    faults: [{ nodeId: 'db', type: 'FAILED', injectAt: 300 }],
  },
  {
    name: 'Circuit Breaker Recovery',
    seed: 99,
    maxVirtualTime: 8000,
    nodes: [
      { id: 'lb', type: 'LoadBalancer', position: chainX(0), requestsPerSecond: 10 },
      baseService('service', chainX(1).x, chainX(1).y, {
        cbFailureThreshold: 3,
        cbRecoveryTimeoutMs: 800,
      }),
      { id: 'db', type: 'Database', position: chainX(2), config: { cbFailureThreshold: 2 } },
    ],
    edges: [
      { source: 'lb', target: 'service' },
      { source: 'service', target: 'db' },
    ],
    faults: [{ nodeId: 'db', type: 'FAILED', injectAt: 200, clearAt: 2000 }],
  },
  {
    name: 'Thundering Herd',
    seed: 13,
    maxVirtualTime: 6000,
    nodes: [
      { id: 'lb', type: 'LoadBalancer', position: { x: 60, y: 240 }, requestsPerSecond: 30 },
      baseService('svc1', 360, 60, { timeoutMs: 200, retryBudget: 2 }),
      baseService('svc2', 360, 60 + V_GAP, { timeoutMs: 200, retryBudget: 2 }),
      baseService('svc3', 360, 60 + V_GAP * 2, { timeoutMs: 200, retryBudget: 2 }),
      {
        id: 'db',
        type: 'Database',
        position: { x: 360 + NODE_W + H_GAP, y: 60 + V_GAP },
        config: { concurrencyLimit: 3, queueDepth: 5 },
      },
    ],
    edges: [
      { source: 'lb', target: 'svc1' },
      { source: 'lb', target: 'svc2' },
      { source: 'lb', target: 'svc3' },
      { source: 'svc1', target: 'db' },
      { source: 'svc2', target: 'db' },
      { source: 'svc3', target: 'db' },
    ],
    faults: [{ nodeId: 'db', type: 'SLOW', injectAt: 500, latencyMs: 350 }],
  },
  {
    name: 'Queue Saturation',
    seed: 21,
    maxVirtualTime: 5000,
    nodes: [
      { id: 'lb', type: 'LoadBalancer', position: chainX(0), requestsPerSecond: 40 },
      baseService('service', chainX(1).x, chainX(1).y, { queueDepth: 3, concurrencyLimit: 2 }),
      {
        id: 'db',
        type: 'Database',
        position: chainX(2),
        config: { concurrencyLimit: 1, queueDepth: 2 },
      },
    ],
    edges: [
      { source: 'lb', target: 'service' },
      { source: 'service', target: 'db' },
    ],
    faults: [{ nodeId: 'db', type: 'SLOW', injectAt: 0, latencyMs: 400 }],
  },
];

export function getScenarioByName(name: string): Scenario | undefined {
  return scenarios.find((s) => s.name === name);
}
