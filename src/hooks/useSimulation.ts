import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Simulation } from '../engine/simulation';
import { DEFAULT_CONFIGS } from '../engine/node';
import type { NodeConfig, NodeId, NodeState, NodeType } from '../engine/types';
import { scenarios, type Scenario } from '../scenarios';
import {
  readUrlState,
  scenarioToUrlState,
  writeUrlState,
  type UrlState,
} from '../utils/urlState';

export type SpeedMultiplier = 1 | 5 | 10 | 50;

export interface Particle {
  id: string;
  edgeSource: string;
  edgeTarget: string;
  color: 'green' | 'red' | 'yellow';
  /** Sim progress 0–1; used for step mode. */
  progress: number;
  /** Virtual ms from dispatch to expected arrival. */
  flightMs: number;
  /** Virtual time when this hop was dispatched (changes on retry). */
  dispatchedAt: number;
}

export const STEP_ANIM_MS = 450;

export interface SimulationSnapshot {
  virtualTime: number;
  nodes: Map<NodeId, NodeState>;
  edges: Array<{ source: NodeId; target: NodeId }>;
  isRunning: boolean;
  seed: number;
  eventsProcessed: number;
  partitions: Set<string>;
}

function scenarioToTopology(scenario: Scenario) {
  return {
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
}

function urlToScenario(state: UrlState): Scenario {
  return {
    name: 'Custom',
    seed: state.seed,
    nodes: state.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      config: n.config,
      requestsPerSecond: n.requestsPerSecond,
    })),
    edges: state.edges,
    faults: state.faults,
  };
}

function buildSnapshot(sim: Simulation, isRunning: boolean): SimulationSnapshot {
  const state = sim.getState();
  return {
    virtualTime: state.virtualTime,
    nodes: state.nodes,
    edges: state.edges,
    isRunning,
    seed: state.seed,
    eventsProcessed: sim.getEventsProcessed(),
    partitions: sim.getPartitions(),
  };
}

function computeParticles(sim: Simulation): Particle[] {
  const state = sim.getState();
  const result: Particle[] = [];
  let count = 0;
  for (const [id, msg] of state.messages) {
    if (msg.status !== 'IN_FLIGHT' || count > 80) continue;

    const edge = state.edges.find((e) => e.source === msg.sourceId && e.target === msg.targetId);
    if (!edge) continue;

    const meta = sim.getMessageMeta(id);
    if (!meta) continue;

    const flightMs = meta.arriveAt - meta.dispatchedAt;
    if (flightMs <= 0) continue;

    const color: Particle['color'] = msg.retryCount > 0 ? 'yellow' : 'green';
    result.push({
      id,
      edgeSource: edge.source,
      edgeTarget: edge.target,
      color,
      progress: sim.getMessageFlightProgress(id),
      flightMs,
      dispatchedAt: meta.dispatchedAt,
    });
    count += 1;
  }
  return result;
}

export function useSimulation() {
  const initialScenario = useMemo(() => {
    const fromUrl = readUrlState();
    if (fromUrl) return urlToScenario(fromUrl);
    return scenarios[0];
  }, []);

  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [positions, setPositions] = useState<Record<NodeId, { x: number; y: number }>>(() =>
    Object.fromEntries(initialScenario.nodes.map((n) => [n.id, n.position])),
  );
  const [selectedNodeId, setSelectedNodeId] = useState<NodeId | null>(null);
  const [speed, setSpeed] = useState<SpeedMultiplier>(10);
  const [isRunning, setIsRunning] = useState(false);
  const [partitionedEdges, setPartitionedEdges] = useState<Set<string>>(new Set());
  const [uiVersion, setUiVersion] = useState(0);

  const simRef = useRef<Simulation | null>(null);
  const snapshotRef = useRef<SimulationSnapshot | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const eventsPerSecondRef = useRef(0);
  const lastFrameRef = useRef<number>(0);
  const targetHorizonRef = useRef<number>(0);
  const isRunningRef = useRef(false);
  const stepAnimStartRef = useRef(0);
  const speedRef = useRef<SpeedMultiplier>(10);

  const bumpUi = useCallback(() => {
    setUiVersion((v) => v + 1);
  }, []);

  const stopPlayback = useCallback(
    (sim: Simulation) => {
      isRunningRef.current = false;
      particlesRef.current = [];
      sim.setRunning(false);
      snapshotRef.current = buildSnapshot(sim, false);
      setIsRunning(false);
      bumpUi();
    },
    [bumpUi],
  );

  const updateRefs = useCallback((sim: Simulation) => {
    snapshotRef.current = buildSnapshot(sim, isRunningRef.current);
    particlesRef.current = computeParticles(sim);
  }, []);

  const syncSnapshot = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    updateRefs(sim);
    bumpUi();
  }, [updateRefs, bumpUi]);

  const initSim = useCallback(
    (nextScenario: Scenario) => {
      const sim = new Simulation(scenarioToTopology(nextScenario), nextScenario.seed);
      simRef.current = sim;
      setPartitionedEdges(new Set());
      updateRefs(sim);
      bumpUi();
    },
    [updateRefs, bumpUi],
  );

  useEffect(() => {
    initSim(initialScenario);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const persistUrl = useCallback((next: Scenario, pos: Record<NodeId, { x: number; y: number }>) => {
    const state: UrlState = {
      seed: next.seed,
      nodes: next.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: pos[n.id] ?? n.position,
        config: { ...DEFAULT_CONFIGS[n.type], ...n.config },
        requestsPerSecond: n.requestsPerSecond,
      })),
      edges: next.edges,
      faults: next.faults,
    };
    writeUrlState(state);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => persistUrl(scenario, positions), 400);
    return () => clearTimeout(timer);
  }, [scenario, positions, persistUrl]);

  useEffect(() => {
    if (!isRunning) return;
    const sim = simRef.current;
    if (!sim) return;

    sim.setRunning(true);
    targetHorizonRef.current = sim.getState().virtualTime;
    let rafId = 0;

    const loop = (now: number) => {
      const activeSim = simRef.current;
      if (!activeSim) return;

      if (lastFrameRef.current === 0) {
        lastFrameRef.current = now;
      }

      const delta = now - lastFrameRef.current;
      if (delta >= 16) {
        const budget = (delta / 16) * (1000 / 60) * speedRef.current;
        const before = activeSim.getEventsProcessed();
        targetHorizonRef.current += budget;
        activeSim.runUntil(targetHorizonRef.current);
        const processed = activeSim.getEventsProcessed() - before;
        eventsPerSecondRef.current = Math.round((processed / delta) * 1000);
        lastFrameRef.current = now;
        updateRefs(activeSim);

        if (activeSim.isAtMaxTime()) {
          stopPlayback(activeSim);
          return;
        }

        const hasWork = activeSim.getState().events.length > 0;
        if (!hasWork && [...activeSim.getState().nodes.values()].every((n) => n.inFlight === 0)) {
          stopPlayback(activeSim);
          return;
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafId);
      lastFrameRef.current = 0;
      isRunningRef.current = false;
      simRef.current?.setRunning(false);
    };
  }, [isRunning, updateRefs, stopPlayback]);

  const play = useCallback(() => {
    isRunningRef.current = true;
    setIsRunning(true);
  }, []);

  const pause = useCallback(() => {
    const sim = simRef.current;
    if (sim) stopPlayback(sim);
    else setIsRunning(false);
  }, [stopPlayback]);

  const reset = useCallback(() => {
    isRunningRef.current = false;
    particlesRef.current = [];
    setIsRunning(false);
    simRef.current?.reset();
    syncSnapshot();
  }, [syncSnapshot]);

  const step = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    sim.step();
    stepAnimStartRef.current = performance.now();
    updateRefs(sim);
    bumpUi();
  }, [updateRefs, bumpUi]);

  const setSeed = useCallback(
    (seed: number) => {
      setScenario((prev) => ({ ...prev, seed }));
      simRef.current?.setSeed(seed);
      syncSnapshot();
    },
    [syncSnapshot],
  );

  const loadScenario = useCallback(
    (name: string) => {
      const found = scenarios.find((s) => s.name === name);
      if (!found) return;
      setScenario(found);
      setPositions(Object.fromEntries(found.nodes.map((n) => [n.id, n.position])));
      setSelectedNodeId(null);
      setIsRunning(false);
      initSim(found);
    },
    [initSim],
  );

  const updateNodeConfig = useCallback(
    (nodeId: NodeId, config: Partial<NodeConfig>) => {
      setScenario((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId ? { ...n, config: { ...DEFAULT_CONFIGS[n.type], ...n.config, ...config } } : n,
        ),
      }));
      simRef.current?.updateNodeConfig(nodeId, config);
      syncSnapshot();
    },
    [syncSnapshot],
  );

  const setNodeRps = useCallback(
    (nodeId: NodeId, rps: number) => {
      setScenario((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, requestsPerSecond: rps } : n)),
      }));
      simRef.current?.setLoadBalancerRps(nodeId, rps);
      syncSnapshot();
    },
    [syncSnapshot],
  );

  const addNode = useCallback(
    (type: NodeType, position: { x: number; y: number }) => {
      const id = `${type.toLowerCase()}-${Date.now()}`;
      const next: Scenario = {
        ...scenario,
        nodes: [...scenario.nodes, { id, type, position, config: DEFAULT_CONFIGS[type] }],
      };
      setScenario(next);
      setPositions((prev) => ({ ...prev, [id]: position }));
      setIsRunning(false);
      initSim(next);
    },
    [scenario, initSim],
  );

  const removeNode = useCallback(
    (nodeId: NodeId) => {
      const next: Scenario = {
        ...scenario,
        nodes: scenario.nodes.filter((n) => n.id !== nodeId),
        edges: scenario.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      };
      setScenario(next);
      setPositions((prev) => {
        const copy = { ...prev };
        delete copy[nodeId];
        return copy;
      });
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      setIsRunning(false);
      initSim(next);
    },
    [scenario, selectedNodeId, initSim],
  );

  const addEdge = useCallback(
    (source: NodeId, target: NodeId) => {
      if (scenario.edges.some((e) => e.source === source && e.target === target)) return;
      const next: Scenario = { ...scenario, edges: [...scenario.edges, { source, target }] };
      setScenario(next);
      setIsRunning(false);
      initSim(next);
    },
    [scenario, initSim],
  );

  const removeEdge = useCallback(
    (source: NodeId, target: NodeId) => {
      const next: Scenario = {
        ...scenario,
        edges: scenario.edges.filter((e) => !(e.source === source && e.target === target)),
      };
      setScenario(next);
      setIsRunning(false);
      initSim(next);
    },
    [scenario, initSim],
  );

  const injectFault = useCallback(
    (nodeId: NodeId, type: 'FAILED' | 'SLOW', latencyMs = 500) => {
      simRef.current?.injectFault(nodeId, type, undefined, latencyMs);
      setScenario((prev) => ({
        ...prev,
        faults: [
          ...prev.faults,
          { nodeId, type, injectAt: snapshotRef.current?.virtualTime ?? 0, latencyMs },
        ],
      }));
      syncSnapshot();
    },
    [syncSnapshot],
  );

  const clearFault = useCallback(
    (nodeId: NodeId) => {
      simRef.current?.clearFault(nodeId);
      setScenario((prev) => ({
        ...prev,
        faults: prev.faults.filter((f) => f.nodeId !== nodeId),
      }));
      syncSnapshot();
    },
    [syncSnapshot],
  );

  const setPartition = useCallback(
    (source: NodeId, target: NodeId, active: boolean) => {
      simRef.current?.setPartition(source, target, active);
      const key = `${source}->${target}`;
      setPartitionedEdges((prev) => {
        const next = new Set(prev);
        if (active) next.add(key);
        else next.delete(key);
        return next;
      });
      syncSnapshot();
    },
    [syncSnapshot],
  );

  const updatePosition = useCallback((nodeId: NodeId, x: number, y: number) => {
    setPositions((prev) => ({ ...prev, [nodeId]: { x, y } }));
  }, []);

  return {
    scenario,
    positions,
    selectedNodeId,
    setSelectedNodeId,
    snapshotRef,
    particlesRef,
    eventsPerSecondRef,
    speed,
    setSpeed,
    isRunning,
    isRunningRef,
    stepAnimStartRef,
    speedRef,
    uiVersion,
    play,
    pause,
    reset,
    step,
    setSeed,
    loadScenario,
    updateNodeConfig,
    setNodeRps,
    addNode,
    removeNode,
    addEdge,
    removeEdge,
    injectFault,
    clearFault,
    setPartition,
    updatePosition,
    partitionedEdges,
    scenarioToUrlState,
  };
}
