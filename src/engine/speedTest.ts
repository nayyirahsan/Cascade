import { DEFAULT_CONFIGS } from './node';
import { Simulation } from './simulation';
import { getScenarioByName } from '../scenarios';

/** Verify speed multiplier advances virtual time at different rates. */
export function runSpeedTest(): { pass: boolean; message: string } {
  const scenario = getScenarioByName('Retry Storm');
  if (!scenario) return { pass: false, message: 'Scenario not found' };

  const topology = {
    nodes: scenario.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      config: { ...DEFAULT_CONFIGS[n.type], ...n.config },
      requestsPerSecond: n.requestsPerSecond,
    })),
    edges: scenario.edges,
    faults: [],
    maxVirtualTime: 100_000,
  };

  const advanceFrames = (speed: number, frames: number) => {
    const sim = new Simulation(topology, 42);
    let horizon = 0;
    for (let i = 0; i < frames; i += 1) {
      const budget = (16 / 16) * (1000 / 60) * speed;
      horizon += budget;
      sim.runUntil(horizon);
    }
    return sim.getState().virtualTime;
  };

  const t1 = advanceFrames(1, 60);
  const t10 = advanceFrames(10, 60);
  const t50 = advanceFrames(50, 60);

  const ratio10 = t10 / t1;
  const ratio50 = t50 / t1;

  if (t1 <= 0) return { pass: false, message: 'Speed 1x produced no virtual time advance' };
  if (ratio10 < 7 || ratio10 > 13) {
    return { pass: false, message: `10x ratio ${ratio10.toFixed(1)} expected ~10` };
  }
  if (ratio50 < 40 || ratio50 > 60) {
    return { pass: false, message: `50x ratio ${ratio50.toFixed(1)} expected ~50` };
  }

  return {
    pass: true,
    message: `Speed OK: 1x=${t1.toFixed(0)}ms, 10x=${t10.toFixed(0)}ms (${ratio10.toFixed(1)}x), 50x=${t50.toFixed(0)}ms (${ratio50.toFixed(1)}x)`,
  };
}
