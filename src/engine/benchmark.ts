import { Simulation, benchmarkSimulation } from './simulation';
import { getScenarioByName, scenarioToTopology } from '../scenarios';

export function runBenchmark(): number {
  const scenario = getScenarioByName('Retry Storm');
  if (!scenario) return 0;

  const sim = new Simulation(
    { ...scenarioToTopology(scenario), maxVirtualTime: 10_000 },
    scenario.seed,
  );

  return benchmarkSimulation(sim, 10_000);
}
