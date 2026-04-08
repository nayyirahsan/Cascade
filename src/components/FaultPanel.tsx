import { useState } from 'react';
import type { useSimulation } from '../hooks/useSimulation';

type SimApi = ReturnType<typeof useSimulation>;

interface FaultPanelProps {
  sim: SimApi;
}

export default function FaultPanel({ sim }: FaultPanelProps) {
  const [latencyMs, setLatencyMs] = useState(500);
  const nodeId = sim.selectedNodeId;

  return (
    <div className="space-y-4">
      {!nodeId ? (
        <p className="text-xs leading-relaxed text-slate-500">
          Click a node on the canvas to inject faults or tune partitions.
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Target: <span className="font-semibold text-slate-200">{nodeId}</span>
          </p>
          <label className="flex flex-col gap-1 text-xs text-slate-400">
            Slow latency (ms)
            <input
              type="number"
              value={latencyMs}
              onChange={(e) => setLatencyMs(Number(e.target.value))}
              className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 tabular-nums"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => sim.injectFault(nodeId, 'FAILED')}
              className="rounded-md bg-red-900/60 px-2.5 py-1 text-xs font-medium text-red-200 hover:bg-red-800/70"
            >
              Node failure
            </button>
            <button
              type="button"
              onClick={() => sim.injectFault(nodeId, 'SLOW', latencyMs)}
              className="rounded-md bg-amber-900/50 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-800/60"
            >
              Latency spike
            </button>
            <button
              type="button"
              onClick={() => sim.clearFault(nodeId)}
              className="rounded-md bg-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 hover:bg-slate-600"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-slate-700/60 pt-3">
        <h4 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
          Edge partitions
        </h4>
        <div className="max-h-36 space-y-1 overflow-y-auto">
          {sim.scenario.edges.length === 0 ? (
            <p className="text-[10px] text-slate-600">No edges in this scenario.</p>
          ) : (
            sim.scenario.edges.map((e) => {
              const key = `${e.source}->${e.target}`;
              const active = sim.partitionedEdges.has(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => sim.setPartition(e.source, e.target, !active)}
                  className={`block w-full rounded-md px-2 py-1.5 text-left text-[10px] font-mono transition-colors ${
                    active
                      ? 'bg-red-950/50 text-red-300 ring-1 ring-red-800/50'
                      : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {key}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
