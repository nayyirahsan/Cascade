import { DEFAULT_CONFIGS } from '../engine/node';
import type { NodeConfig, NodeType } from '../engine/types';
import type { Scenario } from '../scenarios';

export interface UrlState {
  seed: number;
  nodes: Array<{
    id: string;
    type: NodeType;
    position: { x: number; y: number };
    config: NodeConfig;
    requestsPerSecond?: number;
  }>;
  edges: Array<{ source: string; target: string }>;
  faults: Array<{
    nodeId?: string;
    edge?: { source: string; target: string };
    type: 'FAILED' | 'SLOW' | 'PARTITION';
    injectAt: number;
    clearAt?: number;
    latencyMs?: number;
  }>;
}

function toBase64Url(json: string): string {
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

export function encodeState(state: UrlState): string {
  const json = JSON.stringify(state);
  if (json.length > 8000) {
    console.warn('URL state is large; sharing may fail in some browsers.');
  }
  return toBase64Url(json);
}

export function decodeState(param: string): UrlState | null {
  try {
    const json = fromBase64Url(param);
    const parsed = JSON.parse(json) as UrlState;
    // typeof check, not truthiness: seed 0 is valid.
    if (typeof parsed.seed !== 'number' || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function scenarioToUrlState(scenario: Scenario): UrlState {
  return {
    seed: scenario.seed,
    nodes: scenario.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      config: { ...DEFAULT_CONFIGS[n.type], ...n.config },
      requestsPerSecond: n.requestsPerSecond,
    })),
    edges: scenario.edges,
    faults: scenario.faults,
  };
}

export function readUrlState(): UrlState | null {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get('s');
  if (!encoded) return null;
  return decodeState(encoded);
}

export function writeUrlState(state: UrlState): void {
  const encoded = encodeState(state);
  const url = `${window.location.pathname}?s=${encoded}`;
  window.history.replaceState(null, '', url);
}
