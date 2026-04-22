import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { getScenarioByName, scenarioToTopology } from '../../scenarios';
import type { CircuitState, NodeId } from '../types';

function runObserving(
  scenarioName: string,
  observe: (sim: Simulation) => void,
): Simulation {
  const scenario = getScenarioByName(scenarioName)!;
  const sim = new Simulation(scenarioToTopology(scenario), scenario.seed);
  while (sim.step()) {
    observe(sim);
  }
  return sim;
}

function circuitHistory(scenarioName: string, nodeId: NodeId): CircuitState[] {
  const history: CircuitState[] = [];
  runObserving(scenarioName, (sim) => {
    const circuit = sim.getState().nodes.get(nodeId)!.circuit;
    if (history[history.length - 1] !== circuit) history.push(circuit);
  });
  return history;
}

describe('emergent failure modes (not hardcoded)', () => {
  it('retry storm: slowness on B amplifies load via A retries', () => {
    const baselineScenario = getScenarioByName('Retry Storm')!;
    // Control run: same topology, no fault.
    const control = new Simulation(
      { ...scenarioToTopology(baselineScenario), faults: [] },
      baselineScenario.seed,
    );
    while (control.step()) {
      /* drain */
    }
    const withFault = runObserving('Retry Storm', () => {});

    const controlNodes = control.getState().nodes;
    const stormNodes = withFault.getState().nodes;

    // Retries only exist in the faulted run — the fault interacts with
    // timeout + retryBudget; nothing injects retries directly.
    expect(controlNodes.get('serviceA')!.stats.retried).toBe(0);
    expect(stormNodes.get('serviceA')!.stats.retried).toBeGreaterThan(0);

    // Amplification: B sees more total attempts (accepted + breaker-rejected)
    // under the storm than in the healthy control.
    const attempts = (n: { stats: { sent: number; rejected: number } }) =>
      n.stats.sent + n.stats.rejected;
    expect(attempts(stormNodes.get('serviceB')!)).toBeGreaterThan(
      attempts(controlNodes.get('serviceB')!),
    );
  });

  it('cascading failure: DB failure propagates to end-to-end trace failures', () => {
    const sim = runObserving('Cascading Failure', () => {});
    const nodes = sim.getState().nodes;

    const db = nodes.get('db')!;
    expect(db.stats.failed).toBeGreaterThan(0);
    // B exhausts its retry budget against the dead DB.
    expect(nodes.get('serviceB')!.stats.retried).toBeGreaterThan(0);
    // The DB's breaker opens and starts rejecting.
    expect(db.circuit).toBe('OPEN');
    expect(db.stats.rejected).toBeGreaterThan(0);
    // The failure is visible at the entry point: most traces fail end-to-end.
    const lb = nodes.get('lb')!;
    expect(lb.stats.failed).toBeGreaterThan(lb.stats.succeeded);
  });

  it('circuit breaker: opens under failure, recovers after fault clears', () => {
    const history = circuitHistory('Circuit Breaker Recovery', 'db');

    // Must pass through OPEN and end CLOSED again after the fault clears.
    expect(history).toContain('OPEN');
    expect(history).toContain('HALF_OPEN');
    expect(history[0]).toBe('CLOSED');
    expect(history[history.length - 1]).toBe('CLOSED');
    // OPEN must come before the final CLOSED (a real recovery arc).
    expect(history.indexOf('OPEN')).toBeGreaterThan(0);
  });

  it('queue saturation: bounded queues reject once concurrency + depth exhausted', () => {
    const sim = runObserving('Queue Saturation', () => {});
    const nodes = sim.getState().nodes;
    const rejectedTotal =
      nodes.get('service')!.stats.rejected + nodes.get('db')!.stats.rejected;
    expect(rejectedTotal).toBeGreaterThan(0);
  });

  it('thundering herd: shared DB saturates under simultaneous retries', () => {
    let maxDbQueue = 0;
    const sim = runObserving('Thundering Herd', (s) => {
      maxDbQueue = Math.max(maxDbQueue, s.getState().nodes.get('db')!.queuedCount);
    });
    const db = sim.getState().nodes.get('db')!;
    expect(maxDbQueue).toBeGreaterThan(0);
    expect(db.stats.failed + db.stats.rejected).toBeGreaterThan(0);
  });
});
