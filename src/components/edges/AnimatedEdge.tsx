import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from 'reactflow';

export interface AnimatedEdgeData {
  edgeKey: string;
  partitioned?: boolean;
}

function AnimatedEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<AnimatedEdgeData>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const partitioned = data?.partitioned ?? false;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: partitioned ? '#f87171' : '#64748b',
          strokeWidth: partitioned ? 2.5 : 2,
          strokeDasharray: partitioned ? '8 4' : undefined,
          opacity: partitioned ? 1 : 0.85,
        }}
      />
      {partitioned && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
            className="rounded bg-red-950/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-300"
          >
            partitioned
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export default memo(AnimatedEdgeComponent);
