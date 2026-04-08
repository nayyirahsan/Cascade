import { DEFAULT_CONFIGS } from './node';
import { Simulation } from './simulation';
import { getScenarioByName } from '../scenarios';
import type { NodeState } from './types';

function statsSnapshot(nodes: Map<string, NodeState>): Record<string, NodeState['stats']> {
  const out: Record<string, NodeState['stats']> = {};
  for (const [id, node] of nodes) {
    out[id] = { ...node.stats };
  }
  return out;
}

export function runSmokeTest(): { pass: boolean; message: string } {
  const scenario = getScenarioByName('Retry Storm');
  if (!scenario) {
    return { pass: false, message: 'Retry Storm scenario not found' };
  }

  const topology = {
    nodes: scenario.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      config: { ...DEFAULT_CONFIGS[n.type], ...n.config },
      requestsPerSecond: n.requestsPerSecond,
    })),
    edges: scenario.edges,
    faults: scenario.faults,
    maxVirtualTime: scenario.maxVirtualTime,
  };

  const run = () => {
    const sim = new Simulation(topology, scenario.seed);
    while (sim.step()) {
      // run to completion
    }
    return statsSnapshot(sim.getState().nodes);
  };

  const first = run();
  const second = run();

  const identical = JSON.stringify(first) === JSON.stringify(second);
  const serviceBRetries = first.serviceB?.retried ?? 0;
  const serviceASent = first.serviceA?.sent ?? 0;
  const amplified = serviceASent > (first.lb?.sent ?? 0);

  if (!identical) {
    return { pass: false, message: 'Determinism check failed: runs differ' };
  }
  if (!amplified) {
    return { pass: false, message: 'Retry storm not amplified upstream load' };
  }

  return {
    pass: true,
    message: `Smoke test passed. serviceA.sent=${serviceASent}, serviceB.retried=${serviceBRetries}`,
  };
}
