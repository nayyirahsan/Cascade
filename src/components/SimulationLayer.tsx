import { useEffect, useRef, type RefObject } from 'react';
import { useStore, useStoreApi } from 'reactflow';
import { STEP_ANIM_MS, type Particle, type SimulationSnapshot } from '../hooks/useSimulation';
import { buildEdgePath, pointOnHopPath, type HopPath } from '../utils/particleGeometry';

const COLORS: Record<Particle['color'], string> = {
  green: '#34d399',
  red: '#f87171',
  yellow: '#fbbf24',
};

/** Stop just before the target handle along the edge curve. */
const PARTICLE_END = 0.98;

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
  nodeIds: string[];
}

function ParticleOverlay({
  particlesRef,
  isRunningRef,
  stepAnimStartRef,
}: {
  particlesRef: RefObject<Particle[]>;
  isRunningRef: RefObject<boolean>;
  stepAnimStartRef: RefObject<number>;
}) {
  const particlesGroupRef = useRef<SVGGElement>(null);
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

            // Sim-truth position: p.progress is recomputed from virtual time on
            // every play-loop frame, so the dot sits exactly where the engine
            // says the message is — starting at the source handle at dispatch.
            const animProgress = playing ? p.progress : p.progress + stepT * (1 - p.progress);
            const pathT = Math.min(Math.max(animProgress, 0), 1) * PARTICLE_END;
            const { x, y } = pointOnHopPath(hopPath, reversed ? 1 - pathT : pathT);

            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', String(x));
            circle.setAttribute('cy', String(y));
            if (reversed) {
              // Responses travel target→source: smaller hollow dots so return
              // traffic reads as deliberate, not as a rendering glitch.
              circle.setAttribute('r', '3');
              circle.setAttribute('fill', 'none');
              circle.setAttribute('stroke', COLORS[p.color]);
              circle.setAttribute('stroke-width', '1.5');
              circle.setAttribute('opacity', '0.75');
            } else {
              circle.setAttribute('r', '5');
              circle.setAttribute('fill', COLORS[p.color]);
            }
            group.appendChild(circle);
          }
        }
      }

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [particlesRef, isRunningRef, stepAnimStartRef, store]);

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
    />
  );
}
