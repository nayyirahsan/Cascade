import { useCallback, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Node,
  type OnInit,
} from 'reactflow';
import 'reactflow/dist/style.css';
import AnimatedEdge from './edges/AnimatedEdge';
import SimulationLayer from './SimulationLayer';
import SimNode from './nodes/SimNode';
import type { useSimulation } from '../hooks/useSimulation';
import type { NodeType } from '../engine/types';

const nodeTypes = { simNode: SimNode };
const edgeTypes = { animated: AnimatedEdge };

type SimApi = ReturnType<typeof useSimulation>;

interface CanvasProps {
  sim: SimApi;
}

interface FlowGraphProps {
  sim: SimApi;
  topologyNodes: Node[];
  topologyEdges: ReturnType<typeof buildEdges>;
  nodeIds: string[];
}

type BuiltEdge = {
  id: string;
  source: string;
  target: string;
  type: string;
  data: { edgeKey: string; partitioned: boolean };
};

function buildEdges(
  scenarioEdges: Array<{ source: string; target: string }>,
  partitionedEdges: Set<string>,
): BuiltEdge[] {
  return scenarioEdges.map((e) => {
    const edgeKey = `${e.source}->${e.target}`;
    return {
      id: edgeKey,
      source: e.source,
      target: e.target,
      type: 'animated',
      data: {
        edgeKey,
        partitioned: partitionedEdges.has(edgeKey),
      },
    };
  });
}

function FlowGraph({ sim, topologyNodes, topologyEdges, nodeIds }: FlowGraphProps) {
  const fitDoneRef = useRef(false);
  const [nodes, , onNodesChange] = useNodesState(topologyNodes);
  const [edges, , onEdgesChange] = useEdgesState(topologyEdges);

  const onInit: OnInit = useCallback((instance) => {
    if (!fitDoneRef.current) {
      fitDoneRef.current = true;
      requestAnimationFrame(() => {
        instance.fitView({ padding: 0.15, duration: 200 });
      });
    }
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.source && connection.target) {
        sim.addEdge(connection.source, connection.target);
      }
    },
    [sim],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      sim.setSelectedNodeId(node.id);
    },
    [sim],
  );

  const onNodeDragStop = useCallback(
    (_: React.MouseEvent, node: Node) => {
      sim.updatePosition(node.id, node.position.x, node.position.y);
    },
    [sim],
  );

  return (
    <div className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onInit={onInit}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onNodeDragStop={onNodeDragStop}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable
        elementsSelectable
        minZoom={0.3}
        maxZoom={1.5}
        className="bg-slate-950"
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} color="#1e293b" />
        <Controls showInteractive={false} className="!rounded-lg !border !border-slate-700 !shadow-lg" />
        <MiniMap
          pannable
          zoomable
          nodeColor="#334155"
          maskColor="rgb(10 12 16 / 0.75)"
          className="!rounded-lg !border !border-slate-700 !shadow-lg"
        />
      </ReactFlow>
      <SimulationLayer
        snapshotRef={sim.snapshotRef}
        particlesRef={sim.particlesRef}
        isRunningRef={sim.isRunningRef}
        stepAnimStartRef={sim.stepAnimStartRef}
        speedRef={sim.speedRef}
        nodeIds={nodeIds}
      />
    </div>
  );
}

function CanvasInner({ sim }: CanvasProps) {
  const scenarioKey = `${sim.scenario.name}-${sim.scenario.nodes.map((n) => n.id).join(',')}-${sim.scenario.edges.length}`;
  const { project } = useReactFlow();

  const topologyNodes: Node[] = useMemo(
    () =>
      sim.scenario.nodes.map((n) => ({
        id: n.id,
        type: 'simNode',
        position: sim.positions[n.id] ?? n.position,
        data: { label: n.id, nodeId: n.id, nodeType: n.type },
      })),
    [sim.scenario.nodes, sim.positions],
  );

  const topologyEdges = useMemo(
    () => buildEdges(sim.scenario.edges, sim.partitionedEdges),
    [sim.scenario.edges, sim.partitionedEdges],
  );

  const nodeIds = useMemo(() => sim.scenario.nodes.map((n) => n.id), [sim.scenario.nodes]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData('application/cascade-node') as NodeType;
      if (!type) return;
      const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
      // project() converts screen px to flow coordinates, honoring pan/zoom.
      const pos = project({ x: e.clientX - bounds.left, y: e.clientY - bounds.top });
      sim.addNode(type, { x: pos.x - 100, y: pos.y - 80 });
    },
    [sim, project],
  );

  return (
    <div className="relative h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
      <FlowGraph
        key={scenarioKey}
        sim={sim}
        topologyNodes={topologyNodes}
        topologyEdges={topologyEdges}
        nodeIds={nodeIds}
      />
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 w-full max-w-xl -translate-x-1/2 px-4">
        <div className="rounded-lg border border-slate-700/70 bg-slate-950/85 px-4 py-2.5 shadow-lg shadow-black/30 backdrop-blur-sm">
          <div className="text-xs font-bold uppercase tracking-wider text-cyan-400">
            {sim.scenario.name}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">
            {sim.scenario.description}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
