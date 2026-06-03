import { describe, expect, it } from 'vitest';
import { decodeState, encodeState, scenarioToUrlState, type UrlState } from '../urlState';
import { scenarios, scenarioToTopology } from '../../scenarios';
import { Simulation } from '../../engine/simulation';
import type { SimulationState, TopologyInput } from '../../engine/types';

function topologyFromUrl(state: UrlState): TopologyInput {
  return {
    nodes: state.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      config: n.config,
      requestsPerSecond: n.requestsPerSecond,
    })),
    edges: state.edges,
    faults: state.faults as TopologyInput['faults'],
  };
}

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
  return JSON.stringify({ virtualTime: state.virtualTime, nodes });
}

describe('URL state round-trip', () => {
  for (const scenario of scenarios) {
    it(`"${scenario.name}": encode → decode reproduces the exact UrlState`, () => {
      const original = scenarioToUrlState(scenario);
      const decoded = decodeState(encodeState(original));
      expect(decoded).toEqual(original);
    });

    it(`"${scenario.name}": a sim from the decoded URL behaves identically`, () => {
      const decoded = decodeState(encodeState(scenarioToUrlState(scenario)))!;

      const fromScenario = new Simulation(scenarioToTopology(scenario), scenario.seed, {
        trace: true,
      });
      const fromUrl = new Simulation(topologyFromUrl(decoded), decoded.seed, { trace: true });

      // Run both below either maxVirtualTime so the (unshared) cap can't diverge them.
      fromScenario.runUntil(3000);
      fromUrl.runUntil(3000);

      expect(fromUrl.getTrace().length).toBeGreaterThan(0);
      expect(fromUrl.getTrace()).toEqual(fromScenario.getTrace());
      expect(fingerprint(fromUrl.getState())).toEqual(fingerprint(fromScenario.getState()));
    });
  }

  it('accepts seed 0', () => {
    const state = scenarioToUrlState(scenarios[0]);
    state.seed = 0;
    expect(decodeState(encodeState(state))).toEqual(state);
  });

  it('rejects garbage input', () => {
    expect(decodeState('not-base64-json')).toBeNull();
    expect(decodeState(btoa('{"nodes": 5}'))).toBeNull();
    expect(decodeState('')).toBeNull();
  });
});
