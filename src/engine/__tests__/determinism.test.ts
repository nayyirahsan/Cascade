import { describe, expect, it } from 'vitest';
import { Simulation } from '../simulation';
import { getScenarioByName, scenarioToTopology, scenarios } from '../../scenarios';
import type { SimulationState } from '../types';

/** Stable, order-independent serialization of everything observable. */
function fingerprint(state: SimulationState): string {
  const nodes = [...state.nodes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, n]) => ({
      id,
      circuit: n.circuit,
      inFlight: n.inFlight,
      queuedCount: n.queuedCount,
      stats: n.stats,
    }));
  const messages = [...state.messages.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, m]) => ({ id, status: m.status, retryCount: m.retryCount }));
  return JSON.stringify({ virtualTime: state.virtualTime, nodes, messages });
}

function runToCompletion(scenarioName: string, seed?: number) {
  const scenario = getScenarioByName(scenarioName)!;
  const sim = new Simulation(scenarioToTopology(scenario), seed ?? scenario.seed, { trace: true });
  while (sim.step()) {
    // drain all events
  }
  return { sim, fp: fingerprint(sim.getState()), trace: sim.getTrace() };
}

describe('determinism', () => {
  for (const scenario of scenarios) {
    it(`"${scenario.name}": same seed twice → identical event order and final state`, () => {
      const a = runToCompletion(scenario.name);
      const b = runToCompletion(scenario.name);

      expect(a.trace.length).toBeGreaterThan(0);
      expect(b.trace).toEqual(a.trace);
      expect(b.fp).toEqual(a.fp);
      expect(b.sim.getEventsProcessed()).toEqual(a.sim.getEventsProcessed());
    });
  }

  it('different seeds diverge (jitter actually feeds the model)', () => {
    const a = runToCompletion('Retry Storm', 42);
    const b = runToCompletion('Retry Storm', 43);
    expect(b.trace).not.toEqual(a.trace);
  });

  it('two live Simulation instances do not corrupt each other', () => {
    const scenario = getScenarioByName('Retry Storm')!;
    const topology = scenarioToTopology(scenario);

    const solo = new Simulation(topology, scenario.seed, { trace: true });
    while (solo.step()) {
      /* drain */
    }

    // Interleave two instances step-by-step; each must match the solo run.
    const s1 = new Simulation(topology, scenario.seed, { trace: true });
    const s2 = new Simulation(topology, scenario.seed, { trace: true });
    let more1 = true;
    let more2 = true;
    while (more1 || more2) {
      if (more1) more1 = s1.step();
      if (more2) more2 = s2.step();
    }

    expect(s1.getTrace()).toEqual(solo.getTrace());
    expect(s2.getTrace()).toEqual(solo.getTrace());
    expect(fingerprint(s1.getState())).toEqual(fingerprint(solo.getState()));
    expect(fingerprint(s2.getState())).toEqual(fingerprint(solo.getState()));
  });

  it('reset() reproduces the exact same run', () => {
    const scenario = getScenarioByName('Cascading Failure')!;
    const sim = new Simulation(scenarioToTopology(scenario), scenario.seed, { trace: true });
    while (sim.step()) {
      /* drain */
    }
    const firstTrace = sim.getTrace();
    const firstFp = fingerprint(sim.getState());

    sim.reset();
    while (sim.step()) {
      /* drain */
    }
    expect(sim.getTrace()).toEqual(firstTrace);
    expect(fingerprint(sim.getState())).toEqual(firstFp);
  });
});
