import { Simulation } from './simulation';
import { getScenarioByName, scenarioToTopology } from '../scenarios';
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

  const topology = scenarioToTopology(scenario);

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
  const retries = first.serviceA?.retried ?? 0;
  const attemptsAtB = (first.serviceB?.sent ?? 0) + (first.serviceB?.rejected ?? 0);

  if (!identical) {
    return { pass: false, message: 'Determinism check failed: runs differ' };
  }
  if (retries === 0) {
    return { pass: false, message: 'Retry storm produced no retries' };
  }

  return {
    pass: true,
    message: `Smoke test passed. serviceA.retried=${retries}, attempts at serviceB=${attemptsAtB}`,
  };
}
