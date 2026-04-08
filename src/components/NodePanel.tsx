import { useEffect, useState } from 'react';
import { useSimulationLive } from '../context/SimulationLiveContext';
import { DEFAULT_CONFIGS } from '../engine/node';
import type { NodeConfig } from '../engine/types';
import type { useSimulation } from '../hooks/useSimulation';

type SimApi = ReturnType<typeof useSimulation>;

interface NodePanelProps {
  sim: SimApi;
}

function ConfigField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-slate-400">
      {label}
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 tabular-nums text-slate-200"
      />
    </label>
  );
}

export default function NodePanel({ sim }: NodePanelProps) {
  const { snapshotRef } = useSimulationLive();
  const nodeId = sim.selectedNodeId;
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!sim.isRunning || !nodeId) return;
    const interval = setInterval(() => setTick((t) => t + 1), 300);
    return () => clearInterval(interval);
  }, [sim.isRunning, nodeId]);

  if (!nodeId) {
    return (
      <p className="text-xs leading-relaxed text-slate-500">
        Select a node on the canvas to edit retry policy, timeouts, and circuit breaker settings.
      </p>
    );
  }

  const def = sim.scenario.nodes.find((n) => n.id === nodeId);
  if (!def) return null;

  const live = snapshotRef.current?.nodes.get(nodeId);
  const config: NodeConfig = {
    ...DEFAULT_CONFIGS[def.type],
    ...def.config,
    ...live?.config,
  };

  const update = (patch: Partial<NodeConfig>) => sim.updateNodeConfig(nodeId, patch);

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-slate-100">{nodeId}</h3>
        <p className="text-[11px] text-slate-500">{def.type}</p>
      </div>
      <ConfigField label="Retry budget" value={config.retryBudget} onChange={(v) => update({ retryBudget: v })} />
      <ConfigField label="Timeout (ms)" value={config.timeoutMs} onChange={(v) => update({ timeoutMs: v })} />
      <ConfigField
        label="Concurrency limit"
        value={config.concurrencyLimit}
        onChange={(v) => update({ concurrencyLimit: v })}
      />
      <ConfigField label="Queue depth" value={config.queueDepth} onChange={(v) => update({ queueDepth: v })} />
      <ConfigField
        label="CB failure threshold"
        value={config.cbFailureThreshold}
        onChange={(v) => update({ cbFailureThreshold: v })}
      />
      <ConfigField
        label="CB recovery (ms)"
        value={config.cbRecoveryTimeoutMs}
        onChange={(v) => update({ cbRecoveryTimeoutMs: v })}
      />
      {def.type === 'LoadBalancer' && (
        <ConfigField
          label="Requests/sec"
          value={def.requestsPerSecond ?? 10}
          onChange={(v) => sim.setNodeRps(nodeId, v)}
        />
      )}
      <button
        type="button"
        onClick={() => sim.removeNode(nodeId)}
        className="w-full rounded-md border border-red-900/50 bg-red-950/30 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-950/50"
      >
        Remove node
      </button>
    </div>
  );
}
