import { memo } from 'react';
import { Handle, Position, type NodeProps } from 'reactflow';
import { DEFAULT_CONFIGS } from '../../engine/node';
import type { NodeType } from '../../engine/types';

export interface SimNodeData {
  label: string;
  nodeId: string;
  nodeType: NodeType;
}

const typeStyles: Record<
  NodeType,
  { accent: string; badge: string; label: string }
> = {
  LoadBalancer: {
    accent: 'border-t-blue-500',
    badge: 'text-blue-300 bg-blue-500/10 border-blue-500/30',
    label: 'LB',
  },
  Service: {
    accent: 'border-t-emerald-500',
    badge: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30',
    label: 'SVC',
  },
  Database: {
    accent: 'border-t-violet-500',
    badge: 'text-violet-300 bg-violet-500/10 border-violet-500/30',
    label: 'DB',
  },
};

const circuitColors: Record<string, string> = {
  CLOSED: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50',
  OPEN: 'bg-red-500/20 text-red-300 border-red-500/50',
  HALF_OPEN: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
};

function SimNodeComponent({ data, selected }: NodeProps<SimNodeData>) {
  const { label, nodeId, nodeType } = data;
  const defaults = DEFAULT_CONFIGS[nodeType];
  const style = typeStyles[nodeType];

  return (
    <div
      data-sim-node={nodeId}
      className={`w-[200px] rounded-lg border border-slate-600/80 border-t-[3px] bg-slate-900/95 shadow-xl shadow-black/40 ${style.accent} ${
        selected ? 'ring-2 ring-cyan-400/80 ring-offset-1 ring-offset-slate-950' : ''
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-2 !border-slate-950 !bg-cyan-400"
      />
      <div className="space-y-2.5 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-xs font-bold text-slate-100">{label}</div>
            <span
              className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${style.badge}`}
            >
              {style.label}
            </span>
          </div>
          <span
            data-field="circuit"
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold tabular-nums ${circuitColors.CLOSED}`}
          >
            CLOSED
          </span>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-[10px] text-slate-400">
            <span>Queue</span>
            <span data-field="queue" className="tabular-nums text-slate-300">
              0/{defaults.queueDepth}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div
              data-field="queue-bar"
              className="h-full rounded-full bg-amber-400/90 transition-[width] duration-150"
              style={{ width: '0%' }}
            />
          </div>
        </div>

        <div className="text-[10px] text-slate-400">
          In-flight:{' '}
          <span data-field="inflight" className="tabular-nums font-semibold text-slate-200">
            0
          </span>
        </div>

        <div className="grid grid-cols-3 gap-x-2 gap-y-1 rounded-md bg-slate-950/60 p-2 text-[9px]">
          <span className="text-slate-500">
            sent <span data-field="sent" className="tabular-nums text-slate-300">0</span>
          </span>
          <span className="text-emerald-400/90">
            ok <span data-field="ok" className="tabular-nums">0</span>
          </span>
          <span className="text-red-400/90">
            fail <span data-field="fail" className="tabular-nums">0</span>
          </span>
          <span className="text-amber-400/90">
            retry <span data-field="retry" className="tabular-nums">0</span>
          </span>
          <span className="col-span-2 text-orange-400/90">
            rej <span data-field="rej" className="tabular-nums">0</span>
          </span>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-2.5 !w-2.5 !border-2 !border-slate-950 !bg-cyan-400"
      />
    </div>
  );
}

export default memo(SimNodeComponent);
