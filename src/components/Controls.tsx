import { useEffect, useRef, useState } from 'react';
import { useSimulationLive } from '../context/SimulationLiveContext';
import type { SimulationSnapshot, SpeedMultiplier, useSimulation } from '../hooks/useSimulation';

type SimApi = ReturnType<typeof useSimulation>;

interface ControlsProps {
  sim: SimApi;
}

const speeds: SpeedMultiplier[] = [1, 5, 10, 50];

function successRateOf(snap: SimulationSnapshot): number | null {
  let succeeded = 0;
  let failed = 0;
  for (const node of snap.nodes.values()) {
    if (node.type !== 'LoadBalancer') continue;
    succeeded += node.stats.succeeded;
    failed += node.stats.failed;
  }
  const total = succeeded + failed;
  if (total === 0) return null;
  return (succeeded / total) * 100;
}

function successRateClass(rate: number | null): string {
  if (rate === null) return 'text-slate-500';
  if (rate >= 90) return 'text-emerald-400';
  if (rate >= 50) return 'text-amber-400';
  return 'text-red-400';
}

export default function Controls({ sim }: ControlsProps) {
  const { snapshotRef } = useSimulationLive();
  const [virtualTime, setVirtualTime] = useState(0);
  const [eventsPerSecond, setEventsPerSecond] = useState(0);
  const [successRate, setSuccessRate] = useState<number | null>(null);
  const lastTimeRef = useRef(-1);

  useEffect(() => {
    let rafId = 0;
    let lastSlowUpdate = 0;

    const loop = (now: number) => {
      const snap = snapshotRef.current;
      // The display shows 10ms precision, so only re-render when that changes.
      const displayTick = snap ? Math.floor(snap.virtualTime / 10) : -1;
      if (snap && displayTick !== lastTimeRef.current) {
        lastTimeRef.current = displayTick;
        setVirtualTime(snap.virtualTime);
      }
      if (now - lastSlowUpdate > 400) {
        lastSlowUpdate = now;
        setEventsPerSecond(sim.eventsPerSecondRef.current);
        if (snap) setSuccessRate(successRateOf(snap));
      }
      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [sim.eventsPerSecondRef, snapshotRef]);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/80 p-1">
        <button
          type="button"
          onClick={sim.play}
          disabled={sim.isRunning}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-500 disabled:opacity-40"
        >
          Play
        </button>
        <button
          type="button"
          onClick={sim.pause}
          disabled={!sim.isRunning}
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold hover:bg-amber-500 disabled:opacity-40"
        >
          Pause
        </button>
        <button
          type="button"
          onClick={sim.reset}
          className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-600"
        >
          Reset
        </button>
        <button
          type="button"
          onClick={sim.step}
          className="rounded-md bg-slate-700 px-3 py-1.5 text-xs font-semibold hover:bg-slate-600"
        >
          Step
        </button>
      </div>

      <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/80 px-2 py-1">
        <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Speed</span>
        {speeds.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => sim.setSpeed(s)}
            className={`min-w-[2.25rem] rounded-md px-2 py-1 text-xs font-semibold tabular-nums ${
              sim.speed === s
                ? 'bg-cyan-600 text-white shadow-sm shadow-cyan-900/50'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {s}x
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs text-slate-400">
        Seed
        <input
          type="number"
          value={sim.scenario.seed}
          onChange={(e) => sim.setSeed(Number(e.target.value))}
          className="w-16 rounded border border-slate-600 bg-slate-800 px-2 py-0.5 tabular-nums text-slate-200"
        />
      </label>

      <div className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-1.5 text-xs">
        <span className="tabular-nums text-slate-300">
          <span className="text-slate-500">T</span> {(virtualTime / 1000).toFixed(2)}s
        </span>
        <span className="h-3 w-px bg-slate-700" />
        <span className={`font-semibold tabular-nums ${successRateClass(successRate)}`}>
          <span className="font-normal text-slate-500">OK</span>{' '}
          {successRate === null ? '—' : `${successRate.toFixed(0)}%`}
        </span>
        <span className="h-3 w-px bg-slate-700" />
        <span className="tabular-nums text-slate-500">{eventsPerSecond.toLocaleString()} evt/s</span>
      </div>
    </div>
  );
}
