import { DEFAULT_CONFIGS } from './node';
import { Simulation, benchmarkSimulation } from './simulation';
import { getScenarioByName } from '../scenarios';

export function runBenchmark(): number {
  const scenario = getScenarioByName('Retry Storm');
  if (!scenario) return 0;

  const sim = new Simulation(
    {
      nodes: scenario.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        config: { ...DEFAULT_CONFIGS[n.type], ...n.config },
        requestsPerSecond: n.requestsPerSecond,
      })),
      edges: scenario.edges,
      faults: scenario.faults,
      maxVirtualTime: 10_000,
    },
    scenario.seed,
  );

  return benchmarkSimulation(sim, 10_000);
}
