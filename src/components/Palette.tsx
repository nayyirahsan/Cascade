import type { NodeType } from '../engine/types';

const palette: Array<{ type: NodeType; label: string; desc: string; color: string }> = [
  { type: 'LoadBalancer', label: 'Load Balancer', desc: 'Generates traffic', color: 'border-blue-500/80 bg-blue-500/5' },
  { type: 'Service', label: 'Service', desc: 'Retries & circuits', color: 'border-emerald-500/80 bg-emerald-500/5' },
  { type: 'Database', label: 'Database', desc: 'Downstream target', color: 'border-violet-500/80 bg-violet-500/5' },
];

export default function Palette() {
  const onDragStart = (e: React.DragEvent, type: NodeType) => {
    e.dataTransfer.setData('application/cascade-node', type);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="space-y-2">
      {palette.map((item) => (
        <div
          key={item.type}
          draggable
          onDragStart={(e) => onDragStart(e, item.type)}
          className={`cursor-grab rounded-lg border-l-[3px] px-3 py-2.5 active:cursor-grabbing ${item.color}`}
        >
          <div className="text-sm font-medium text-slate-200">{item.label}</div>
          <div className="text-[10px] text-slate-500">{item.desc}</div>
        </div>
      ))}
      <p className="pt-1 text-[10px] leading-relaxed text-slate-600">
        Drag a node onto the canvas, then connect handles to define request flow.
      </p>
    </div>
  );
}
