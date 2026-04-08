import {
  getBezierPath,
  internalsSymbol,
  Position,
  type Edge,
  type HandleElement,
  type Node,
  type NodeHandleBounds,
} from 'reactflow';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const pathProbe = document.createElementNS('http://www.w3.org/2000/svg', 'path');

/** Mirrors React Flow's internal getNodeData — requires measured handles. */
function getNodeData(node: Node | undefined): [Rect, NodeHandleBounds | null, boolean] {
  const handleBounds = node?.[internalsSymbol]?.handleBounds ?? null;
  const isValid = Boolean(
    handleBounds &&
      node?.width &&
      node?.height &&
      typeof node.positionAbsolute?.x !== 'undefined' &&
      typeof node.positionAbsolute?.y !== 'undefined',
  );

  return [
    {
      x: node?.positionAbsolute?.x ?? 0,
      y: node?.positionAbsolute?.y ?? 0,
      width: node?.width ?? 0,
      height: node?.height ?? 0,
    },
    handleBounds,
    isValid,
  ];
}

function getHandle(bounds: HandleElement[] | null, handleId?: string | null): HandleElement | null {
  if (!bounds) return null;
  if (bounds.length === 1 || !handleId) return bounds[0];
  return bounds.find((h) => h.id === handleId) ?? null;
}

/** Mirrors React Flow's internal getHandlePosition. */
function getHandlePosition(position: Position, nodeRect: Rect, handle: HandleElement | null): {
  x: number;
  y: number;
} {
  const x = (handle?.x ?? 0) + nodeRect.x;
  const y = (handle?.y ?? 0) + nodeRect.y;
  const width = handle?.width ?? nodeRect.width;
  const height = handle?.height ?? nodeRect.height;

  switch (position) {
    case Position.Top:
      return { x: x + width / 2, y };
    case Position.Right:
      return { x: x + width, y: y + height / 2 };
    case Position.Bottom:
      return { x: x + width / 2, y: y + height };
    case Position.Left:
      return { x, y: y + height / 2 };
    default:
      return { x, y };
  }
}

function getEdgeEndpoints(
  sourceRect: Rect,
  sourceHandle: HandleElement,
  sourcePosition: Position,
  targetRect: Rect,
  targetHandle: HandleElement,
  targetPosition: Position,
): { sourceX: number; sourceY: number; targetX: number; targetY: number } {
  const from = getHandlePosition(sourcePosition, sourceRect, sourceHandle);
  const to = getHandlePosition(targetPosition, targetRect, targetHandle);
  return { sourceX: from.x, sourceY: from.y, targetX: to.x, targetY: to.y };
}

export interface HopPath {
  path: string;
  length: number;
}

export type NodeInternals = Map<string, Node>;

/** Build the exact same bezier path React Flow draws for an edge. */
export function buildEdgePath(edge: Edge, nodeInternals: NodeInternals): HopPath | null {
  const [sourceRect, sourceHandleBounds, sourceValid] = getNodeData(nodeInternals.get(edge.source));
  const [targetRect, targetHandleBounds, targetValid] = getNodeData(nodeInternals.get(edge.target));
  if (!sourceValid || !targetValid || !sourceHandleBounds || !targetHandleBounds) return null;

  const sourceHandle = getHandle(sourceHandleBounds.source, edge.sourceHandle);
  const targetHandle = getHandle(targetHandleBounds.target, edge.targetHandle);
  if (!sourceHandle || !targetHandle) return null;

  const sourcePosition = sourceHandle.position ?? Position.Right;
  const targetPosition = targetHandle.position ?? Position.Left;

  const { sourceX, sourceY, targetX, targetY } = getEdgeEndpoints(
    sourceRect,
    sourceHandle,
    sourcePosition,
    targetRect,
    targetHandle,
    targetPosition,
  );

  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  pathProbe.setAttribute('d', path);
  const length = pathProbe.getTotalLength();
  if (length <= 0) return null;

  return { path, length };
}

export function pointOnHopPath(hopPath: HopPath, t: number): { x: number; y: number } {
  pathProbe.setAttribute('d', hopPath.path);
  const clamped = Math.min(Math.max(t, 0), 1);
  const p = pathProbe.getPointAtLength(hopPath.length * clamped);
  return { x: p.x, y: p.y };
}
