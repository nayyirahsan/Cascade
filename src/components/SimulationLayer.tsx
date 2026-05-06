import { useEffect, useRef, type RefObject } from 'react';
import { useStore, useStoreApi } from 'reactflow';
import {
  STEP_ANIM_MS,
  type Particle,
  type SimulationSnapshot,
  type SpeedMultiplier,
} from '../hooks/useSimulation';
import { buildEdgePath, pointOnHopPath, type HopPath } from '../utils/particleGeometry';

const COLORS: Record<Particle['color'], string> = {
  green: '#34d399',
  red: '#f87171',
  yellow: '#fbbf24',
};

/** Stop just before the target handle along the edge curve. */
const PARTICLE_END = 0.98;

/** Spread newly dispatched dots so they don't overlap on the same handle. */
function hashPhase(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h / 4294967296;
}

interface ParticleVisual {
  firstSeenAt: number;
  dispatchedAt: number;
}

function playProgress(
  p: Particle,
  now: number,
  speed: SpeedMultiplier,
  visual: ParticleVisual,
): number {
  const wallMs = Math.max(p.flightMs / speed, 20);
  const elapsed = now - visual.firstSeenAt;
  return Math.min(1, elapsed / wallMs);
}

const CIRCUIT_CLASS: Record<string, string> = {
  CLOSED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
  OPEN: 'bg-red-500/20 text-red-300 border-red-500/50',
  HALF_OPEN: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
};

function updateNodeDom(nodeId: string, snapshot: SimulationSnapshot) {
  const node = snapshot.nodes.get(nodeId);
  if (!node) return;

  const root = document.querySelector(`[data-sim-node="${nodeId}"]`);
  if (!root) return;

  const circuit = root.querySelector('[data-field="circuit"]');
  if (circuit) {
    circuit.textContent = node.circuit;
    circuit.className = `shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold tabular-nums ${CIRCUIT_CLASS[node.circuit]}`;
  }

  const set = (field: string, value: string) => {
    const el = root.querySelector(`[data-field="${field}"]`);
    if (el) el.textContent = value;
  };

  set('queue', `${node.queuedCount}/${node.config.queueDepth}`);
  set('inflight', String(node.inFlight));
  set('sent', String(node.stats.sent));
  set('ok', String(node.stats.succeeded));
  set('fail', String(node.stats.failed));
  set('retry', String(node.stats.retried));
  set('rej', String(node.stats.rejected));

  const bar = root.querySelector('[data-field="queue-bar"]') as HTMLElement | null;
  if (bar) {
    const pct =
      node.config.queueDepth > 0
        ? Math.min(100, (node.queuedCount / node.config.queueDepth) * 100)
        : 0;
    bar.style.width = `${pct}%`;
  }
}

interface SimulationLayerProps {
  snapshotRef: RefObject<SimulationSnapshot | null>;
  particlesRef: RefObject<Particle[]>;
  isRunningRef: RefObject<boolean>;
  stepAnimStartRef: RefObject<number>;
  speedRef: RefObject<SpeedMultiplier>;
  nodeIds: string[];
}

function ParticleOverlay({
  particlesRef,
  isRunningRef,
  stepAnimStartRef,
  speedRef,
}: {
  particlesRef: RefObject<Particle[]>;
  isRunningRef: RefObject<boolean>;
  stepAnimStartRef: RefObject<number>;
  speedRef: RefObject<SpeedMultiplier>;
}) {
  const particlesGroupRef = useRef<SVGGElement>(null);
  const particleVisualRef = useRef(new Map<string, ParticleVisual>());
  const store = useStoreApi();
  const transform = useStore((s) => s.transform);

  useEffect(() => {
    let rafId = 0;

    const tick = (now: number) => {
      const group = particlesGroupRef.current;
      if (group) {
        while (group.firstChild) group.removeChild(group.firstChild);

        const playing = isRunningRef.current;
        const stepElapsed = now - stepAnimStartRef.current;
        const stepping = !playing && stepAnimStartRef.current > 0 && stepElapsed < STEP_ANIM_MS;
        const particles = particlesRef.current ?? [];

        if ((playing || stepping) && particles.length > 0) {
          const { nodeInternals, edges } = store.getState();
          const pathCache = new Map<string, HopPath | null>();
          const stepT = stepping ? Math.min(stepElapsed / STEP_ANIM_MS, 1) : 0;
          const activeIds = new Set(particles.map((p) => p.id));

          for (const id of particleVisualRef.current.keys()) {
            if (!activeIds.has(id)) particleVisualRef.current.delete(id);
          }

          for (const p of particles) {
            const pathKey = `${p.edgeSource}->${p.edgeTarget}`;
            // Responses travel the same edge in reverse; reuse the forward
            // path and flip the traversal direction.
            let reversed = false;
            let hopPath = pathCache.get(pathKey);
            if (hopPath === undefined) {
              const edge = edges.find((e) => e.source === p.edgeSource && e.target === p.edgeTarget);
              hopPath = edge ? buildEdgePath(edge, nodeInternals) : null;
              pathCache.set(pathKey, hopPath);
            }
            if (!hopPath) {
              const reverseKey = `${p.edgeTarget}->${p.edgeSource}`;
              let reversePath = pathCache.get(reverseKey);
              if (reversePath === undefined) {
                const edge = edges.find(
                  (e) => e.source === p.edgeTarget && e.target === p.edgeSource,
                );
                reversePath = edge ? buildEdgePath(edge, nodeInternals) : null;
                pathCache.set(reverseKey, reversePath);
              }
              if (!reversePath) continue;
              hopPath = reversePath;
              reversed = true;
            }

            let animProgress: number;
            if (playing) {
              let visual = particleVisualRef.current.get(p.id);
              if (!visual || visual.dispatchedAt !== p.dispatchedAt) {
                visual = { firstSeenAt: now, dispatchedAt: p.dispatchedAt };
                particleVisualRef.current.set(p.id, visual);
              }
              animProgress = playProgress(p, now, speedRef.current, visual);
            } else {
              animProgress = p.progress + stepT * (1 - p.progress);
            }

            const stagger = animProgress < 0.06 ? hashPhase(p.id) * 0.05 : 0;
            const pathT = Math.min(Math.max(animProgress + stagger, 0), 1) * PARTICLE_END;
            const { x, y } = pointOnHopPath(hopPath, reversed ? 1 - pathT : pathT);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(x));
            circle.setAttribute('cy', String(y));
            circle.setAttribute('r', reversed ? '3.5' : '5');
            circle.setAttribute('fill', COLORS[p.color]);
            if (reversed) circle.setAttribute('opacity', '0.7');
            group.appendChild(circle);
          }
        } else if (!playing && !stepping) {
          particleVisualRef.current.clear();
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [particlesRef, isRunningRef, stepAnimStartRef, speedRef, store]);

  const [tx, ty, zoom] = transform;

  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden" aria-hidden>
      <g ref={particlesGroupRef} transform={`translate(${tx},${ty}) scale(${zoom})`} />
    </svg>
  );
}

export default function SimulationLayer({
  snapshotRef,
  particlesRef,
  isRunningRef,
  stepAnimStartRef,
  speedRef,
  nodeIds,
}: SimulationLayerProps) {
  const nodeIdsKey = nodeIds.join(',');

  useEffect(() => {
    let rafId = 0;

    const tick = () => {
      const snap = snapshotRef.current;
      if (snap) {
        for (const id of nodeIdsKey.split(',').filter(Boolean)) {
          updateNodeDom(id, snap);
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [snapshotRef, nodeIdsKey]);

  return (
    <ParticleOverlay
      particlesRef={particlesRef}
      isRunningRef={isRunningRef}
      stepAnimStartRef={stepAnimStartRef}
      speedRef={speedRef}
    />
  );
}
