import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Simulation } from '../engine/simulation';
import { DEFAULT_CONFIGS } from '../engine/node';
import type { FaultType, NodeConfig, NodeId, NodeState, NodeType } from '../engine/types';
import { scenarios, scenarioToTopology, type Scenario } from '../scenarios';
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
  faults: Map<NodeId, FaultType>;
  isRunning: boolean;
  seed: number;
  eventsProcessed: number;
  partitions: Set<string>;
}

function urlToScenario(state: UrlState): Scenario {
  return {
    name: 'Custom',
    description: 'Custom topology loaded from a shared URL.',
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

// Uses the engine's cheap accessors — getState() deep-copies every message
// and the whole event heap, which is too expensive to run per rAF frame.
function buildSnapshot(sim: Simulation, isRunning: boolean): SimulationSnapshot {
  return {
    virtualTime: sim.getVirtualTime(),
    nodes: sim.getNodeStates(),
    edges: sim.getEdges(),
    faults: sim.getFaults(),
    isRunning,
    seed: sim.getSeed(),
    eventsProcessed: sim.getEventsProcessed(),
    partitions: sim.getPartitions(),
  };
}

const MAX_PARTICLES = 80;

function computeParticles(sim: Simulation): Particle[] {
  const faults = sim.getFaults();
  const result: Particle[] = [];
  // Edges are directional both ways for particles: requests A→B and responses B→A.
  const edgeSet = new Set<string>();
  for (const e of sim.getEdges()) {
    edgeSet.add(`${e.source}->${e.target}`);
    edgeSet.add(`${e.target}->${e.source}`);
  }

  for (const msg of sim.getInFlightMessages()) {
    if (result.length >= MAX_PARTICLES) break;
    if (!edgeSet.has(`${msg.sourceId}->${msg.targetId}`)) continue;

    const id = msg.id;
    const meta = sim.getMessageMeta(id);
    if (!meta) continue;

    const flightMs = meta.arriveAt - meta.dispatchedAt;
    if (flightMs <= 0) continue;

    // Red: headed into a node with an active hard fault (doomed request).
    // Yellow: a retry attempt. Green: normal traffic.
    let color: Particle['color'] = 'green';
    if (faults.get(msg.targetId) === 'FAILED') color = 'red';
    else if (msg.retryCount > 0) color = 'yellow';

    result.push({
      id,
      edgeSource: msg.sourceId,
      edgeTarget: msg.targetId,
      color,
      progress: sim.getMessageFlightProgress(id),
      flightMs,
      dispatchedAt: meta.dispatchedAt,
    });
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
  const [speed, setSpeed] = useState<SpeedMultiplier>(1);
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
  const speedRef = useRef<SpeedMultiplier>(1);

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
      // If the rAF loop is already running it keeps going with the new sim;
      // a stale horizon from the previous run would fast-forward it instantly.
      targetHorizonRef.current = 0;
      setPartitionedEdges(new Set());
      updateRefs(sim);
      bumpUi();
    },
    [updateRefs, bumpUi],
  );

  useEffect(() => {
    // Inline sim creation instead of initSim(): partitionedEdges/uiVersion are
    // already at their initial values at mount, so no setState is needed here.
    const sim = new Simulation(scenarioToTopology(initialScenario), initialScenario.seed);
    simRef.current = sim;
    targetHorizonRef.current = 0;
    updateRefs(sim);
    // Auto-play shortly after load so the first thing a visitor sees is a
    // live simulation, not an empty paused canvas.
    const timer = setTimeout(() => {
      isRunningRef.current = true;
      setIsRunning(true);
    }, 800);
    return () => clearTimeout(timer);
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
    targetHorizonRef.current = sim.getVirtualTime();
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

        if (activeSim.isIdle()) {
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
      initSim(found);
      // Picking a scenario starts it immediately — one click to a live demo.
      isRunningRef.current = true;
      setIsRunning(true);
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
