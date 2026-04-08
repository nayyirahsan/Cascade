import { createPrng, type Prng } from './prng';
import { EventQueue } from './scheduler';
import {
  PROPAGATION_DELAY_MS,
  computeBackoffMs,
  createMessage,
  createMessageId,
  resetMessageCounter,
} from './message';
import { createNodeState, processingTimeMs } from './node';
import type {
  FaultDefinition,
  FaultType,
  LoadBalancerMeta,
  Message,
  NodeId,
  NodeState,
  SimEvent,
  SimulationState,
  TopologyInput,
} from './types';

const LOAD_GENERATION_KIND = 'LOAD_GENERATION';

interface PendingQueueItem {
  messageId: string;
  sourceId: NodeId;
  targetId: NodeId;
  isResponse: boolean;
  traceId: string;
  originId: NodeId;
}

interface MessageMeta {
  isResponse: boolean;
  traceId: string;
  originId: NodeId;
  dispatchedAt: number;
  arriveAt: number;
}

let eventCounter = 0;

function resetEventCounter(): void {
  eventCounter = 0;
}

function edgeKey(source: NodeId, target: NodeId): string {
  return `${source}->${target}`;
}

export class Simulation {
  private queue = new EventQueue();
  private virtualTime = 0;
  private nodes = new Map<NodeId, NodeState>();
  private edges: Array<{ source: NodeId; target: NodeId }> = [];
  private messages = new Map<string, Message>();
  private messageMeta = new Map<string, MessageMeta>();
  private faults = new Map<NodeId, FaultType>();
  private slowFaults = new Map<NodeId, number>();
  private partitions = new Set<string>();
  private pendingQueues = new Map<NodeId, PendingQueueItem[]>();
  private loadBalancers = new Map<NodeId, LoadBalancerMeta>();
  private prng: Prng;
  private seed: number;
  private maxVirtualTime: number;
  private isRunning = false;
  private eventsProcessed = 0;
  private activeTraces = new Set<string>();
  private topologyInput: TopologyInput;

  constructor(topology: TopologyInput, seed: number) {
    this.seed = seed;
    this.prng = createPrng(seed);
    this.maxVirtualTime = topology.maxVirtualTime ?? 30_000;
    this.topologyInput = topology;
    this.initTopology(topology);
    this.scheduleFaultTimeline(topology.faults ?? []);
  }

  private initTopology(topology: TopologyInput): void {
    resetEventCounter();
    resetMessageCounter();
    this.queue = new EventQueue();
    this.virtualTime = 0;
    this.nodes.clear();
    this.edges = [...topology.edges];
    this.messages.clear();
    this.messageMeta.clear();
    this.faults.clear();
    this.slowFaults.clear();
    this.partitions.clear();
    this.pendingQueues.clear();
    this.loadBalancers.clear();
    this.activeTraces.clear();
    this.eventsProcessed = 0;
    this.prng = createPrng(this.seed);

    for (const node of topology.nodes) {
      this.nodes.set(node.id, createNodeState(node.id, node.type, node.config));
      if (node.type === 'LoadBalancer') {
        this.loadBalancers.set(node.id, {
          requestsPerSecond: node.requestsPerSecond ?? 10,
          roundRobinIndex: 0,
        });
        this.scheduleLoadGeneration(node.id, 0);
      }
      this.pendingQueues.set(node.id, []);
    }
  }

  private nextEventId(): string {
    eventCounter += 1;
    return `evt-${eventCounter}`;
  }

  private enqueue(event: Omit<SimEvent, 'id'> & { id?: string }): void {
    this.queue.push({
      id: event.id ?? this.nextEventId(),
      type: event.type,
      virtualTime: event.virtualTime,
      payload: event.payload,
    });
  }

  private scheduleLoadGeneration(lbId: NodeId, at: number): void {
    this.enqueue({
      type: 'MESSAGE_SEND',
      virtualTime: at,
      payload: { kind: LOAD_GENERATION_KIND, lbId },
    });
  }

  private scheduleNextLoad(lbId: NodeId): void {
    const meta = this.loadBalancers.get(lbId);
    if (!meta) return;
    const interval = 1000 / meta.requestsPerSecond;
    this.enqueue({
      type: 'MESSAGE_SEND',
      virtualTime: this.virtualTime + interval,
      payload: { kind: LOAD_GENERATION_KIND, lbId },
    });
  }

  private scheduleFaultTimeline(faults: FaultDefinition[]): void {
    for (const fault of faults) {
      this.enqueue({
        type: 'FAULT_INJECT',
        virtualTime: fault.injectAt,
        payload: {
          nodeId: fault.nodeId,
          edge: fault.edge,
          faultType: fault.type,
          latencyMs: fault.latencyMs ?? 500,
        },
      });
      if (fault.clearAt !== undefined) {
        this.enqueue({
          type: 'FAULT_CLEAR',
          virtualTime: fault.clearAt,
          payload: {
            nodeId: fault.nodeId,
            edge: fault.edge,
            faultType: fault.type,
          },
        });
      }
    }
  }

  private downstreamOf(nodeId: NodeId): NodeId[] {
    return this.edges.filter((e) => e.source === nodeId).map((e) => e.target);
  }

  private getNode(nodeId: NodeId): NodeState {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Unknown node: ${nodeId}`);
    return node;
  }

  step(): boolean {
    const event = this.queue.peek();
    if (!event) {
      return this.hasActiveWork();
    }
    if (this.virtualTime >= this.maxVirtualTime) {
      return false;
    }

    this.queue.pop();
    this.virtualTime = event.virtualTime;
    this.processEvent(event);
    this.eventsProcessed += 1;
    this.drainQueues();

    if (this.virtualTime >= this.maxVirtualTime) {
      return false;
    }
    return this.hasActiveWork();
  }

  runUntil(targetVirtualTime: number): number {
    const start = this.eventsProcessed;
    while (this.queue.size() > 0) {
      const next = this.queue.peek();
      if (!next || next.virtualTime > targetVirtualTime) break;
      if (!this.step()) break;
    }
    return this.eventsProcessed - start;
  }

  private hasActiveWork(): boolean {
    if (this.queue.size() > 0) return true;
    for (const node of this.nodes.values()) {
      if (node.inFlight > 0 || node.queuedCount > 0) return true;
    }
    return this.activeTraces.size > 0;
  }

  getState(): SimulationState {
    return {
      virtualTime: this.virtualTime,
      nodes: new Map(
        [...this.nodes.entries()].map(([id, node]) => [
          id,
          { ...node, config: { ...node.config }, stats: { ...node.stats } },
        ]),
      ),
      edges: [...this.edges],
      messages: new Map(
        [...this.messages.entries()].map(([id, msg]) => [id, { ...msg }] as const),
      ),
      events: this.queue.toArray(),
      faults: new Map(this.faults),
      isRunning: this.isRunning,
      seed: this.seed,
    };
  }

  getEventsProcessed(): number {
    return this.eventsProcessed;
  }

  getMaxVirtualTime(): number {
    return this.maxVirtualTime;
  }

  isAtMaxTime(): boolean {
    return this.virtualTime >= this.maxVirtualTime;
  }

  getPartitions(): Set<string> {
    return new Set(this.partitions);
  }

  getSlowFaults(): Map<NodeId, number> {
    return new Map(this.slowFaults);
  }

  getMessageMeta(messageId: string): MessageMeta | undefined {
    return this.messageMeta.get(messageId);
  }

  getMessageFlightProgress(messageId: string): number {
    const meta = this.messageMeta.get(messageId);
    if (!meta) return 0;
    const duration = meta.arriveAt - meta.dispatchedAt;
    if (duration <= 0) return 0;
    return Math.min(1, Math.max(0, (this.virtualTime - meta.dispatchedAt) / duration));
  }

  setRunning(running: boolean): void {
    this.isRunning = running;
  }

  reset(): void {
    this.initTopology(this.topologyInput);
    this.scheduleFaultTimeline(this.topologyInput.faults ?? []);
    this.isRunning = false;
  }

  loadTopology(topology: TopologyInput, seed?: number): void {
    if (seed !== undefined) {
      this.seed = seed;
    }
    this.topologyInput = topology;
    this.initTopology(topology);
    this.scheduleFaultTimeline(topology.faults ?? []);
    this.isRunning = false;
  }

  setSeed(seed: number): void {
    this.seed = seed;
    this.reset();
  }

  injectFault(nodeId: NodeId, type: FaultType, at?: number, latencyMs = 500): void {
    this.enqueue({
      type: 'FAULT_INJECT',
      virtualTime: at ?? this.virtualTime,
      payload: { nodeId, faultType: type, latencyMs },
    });
  }

  clearFault(nodeId: NodeId, at?: number): void {
    this.enqueue({
      type: 'FAULT_CLEAR',
      virtualTime: at ?? this.virtualTime,
      payload: { nodeId },
    });
  }

  setPartition(source: NodeId, target: NodeId, active: boolean): void {
    const key = edgeKey(source, target);
    if (active) {
      this.partitions.add(key);
    } else {
      this.partitions.delete(key);
    }
  }

  updateNodeConfig(nodeId: NodeId, config: Partial<NodeState['config']>): void {
    const node = this.getNode(nodeId);
    node.config = { ...node.config, ...config };
  }

  setLoadBalancerRps(lbId: NodeId, rps: number): void {
    const meta = this.loadBalancers.get(lbId);
    if (meta) {
      meta.requestsPerSecond = rps;
    }
  }

  private processEvent(event: SimEvent): void {
    switch (event.type) {
      case 'MESSAGE_SEND':
        this.handleMessageSend(event);
        break;
      case 'MESSAGE_ARRIVE':
        this.handleMessageArrive(event);
        break;
      case 'MESSAGE_TIMEOUT':
        this.handleMessageTimeout(event);
        break;
      case 'RETRY_SCHEDULED':
        this.handleRetryScheduled(event);
        break;
      case 'CIRCUIT_PROBE':
        this.handleCircuitProbe(event);
        break;
      case 'FAULT_INJECT':
        this.handleFaultInject(event);
        break;
      case 'FAULT_CLEAR':
        this.handleFaultClear(event);
        break;
      default:
        break;
    }
  }

  private handleMessageSend(event: SimEvent): void {
    const { kind, lbId } = event.payload as { kind?: string; lbId?: NodeId };
    if (kind === LOAD_GENERATION_KIND && lbId) {
      this.generateLoad(lbId);
      this.scheduleNextLoad(lbId);
      return;
    }

    const messageId = event.payload.messageId as string;
    const sourceId = event.payload.sourceId as NodeId;
    const targetId = event.payload.targetId as NodeId;
    const isResponse = Boolean(event.payload.isResponse);
    const traceId = event.payload.traceId as string;
    const originId = event.payload.originId as NodeId;

    const target = this.getNode(targetId);

    if (target.circuit === 'OPEN') {
      target.stats.rejected += 1;
      this.handleTraceFailure(traceId, originId, targetId, messageId);
      return;
    }

    if (target.circuit === 'HALF_OPEN' && !event.payload.isProbe) {
      target.stats.rejected += 1;
      this.handleTraceFailure(traceId, originId, targetId, messageId);
      return;
    }

    if (target.inFlight >= target.config.concurrencyLimit) {
      const queue = this.pendingQueues.get(targetId) ?? [];
      if (queue.length < target.config.queueDepth) {
        queue.push({ messageId, sourceId, targetId, isResponse, traceId, originId });
        this.pendingQueues.set(targetId, queue);
        target.queuedCount = queue.length;
        return;
      }
      target.stats.rejected += 1;
      this.handleTraceFailure(traceId, originId, targetId, messageId);
      return;
    }

    const message = this.messages.get(messageId);
    if (message) {
      message.status = 'IN_FLIGHT';
    } else {
      const newMsg = createMessage(sourceId, targetId, this.virtualTime);
      newMsg.id = messageId;
      this.messages.set(messageId, newMsg);
    }

    const latency =
      PROPAGATION_DELAY_MS +
      processingTimeMs(target.type) +
      (this.slowFaults.get(targetId) ?? 0);
    const arriveAt = this.virtualTime + latency;

    this.messageMeta.set(messageId, {
      isResponse,
      traceId,
      originId,
      dispatchedAt: this.virtualTime,
      arriveAt,
    });
    target.inFlight += 1;
    target.stats.sent += 1;

    this.enqueue({
      type: 'MESSAGE_ARRIVE',
      virtualTime: arriveAt,
      payload: { messageId, isProbe: Boolean(event.payload.isProbe) },
    });

    const timeoutAt = this.virtualTime + target.config.timeoutMs;
    this.enqueue({
      type: 'MESSAGE_TIMEOUT',
      virtualTime: timeoutAt,
      payload: { messageId, targetId },
    });
  }

  private generateLoad(lbId: NodeId): void {
    const downstream = this.downstreamOf(lbId);
    if (downstream.length === 0) return;

    const meta = this.loadBalancers.get(lbId)!;
    const targetId = downstream[meta.roundRobinIndex % downstream.length];
    meta.roundRobinIndex += 1;

    const traceId = createMessageId();
    this.activeTraces.add(traceId);
    const messageId = createMessageId();

    const lb = this.getNode(lbId);
    lb.stats.sent += 1;

    this.enqueue({
      type: 'MESSAGE_SEND',
      virtualTime: this.virtualTime,
      payload: {
        messageId,
        sourceId: lbId,
        targetId,
        isResponse: false,
        traceId,
        originId: lbId,
      },
    });
  }

  private handleMessageArrive(event: SimEvent): void {
    const messageId = event.payload.messageId as string;
    const message = this.messages.get(messageId);
    if (!message || message.status !== 'IN_FLIGHT') return;

    const meta = this.messageMeta.get(messageId);
    if (!meta) return;

    const target = this.getNode(message.targetId);
    const partitionKey = edgeKey(message.sourceId, message.targetId);

    let failed = false;

    if (this.partitions.has(partitionKey)) {
      failed = true;
    } else if (this.faults.get(message.targetId) === 'FAILED') {
      failed = true;
    } else if (target.circuit === 'HALF_OPEN' && !event.payload.isProbe) {
      failed = true;
    }

    if (!failed) {
      message.status = 'DELIVERED';
      target.inFlight = Math.max(0, target.inFlight - 1);
      target.consecutiveFailures = 0;

      if (target.circuit === 'HALF_OPEN') {
        target.circuit = 'CLOSED';
      }

      if (meta.isResponse) {
        target.stats.succeeded += 1;
        if (message.targetId === meta.originId) {
          this.completeTrace(meta.traceId, meta.originId);
        } else {
          this.sendHop(message.targetId, message.sourceId, meta, true);
        }
      } else {
        this.forwardOrComplete(meta, message);
      }
      return;
    }

    this.failMessage(message, target, meta);
  }

  private sendHop(
    sourceId: NodeId,
    targetId: NodeId,
    meta: MessageMeta,
    isResponse: boolean,
    isProbe = false,
  ): void {
    const messageId = createMessageId();
    this.messages.set(messageId, createMessage(sourceId, targetId, this.virtualTime));
    this.enqueue({
      type: 'MESSAGE_SEND',
      virtualTime: this.virtualTime,
      payload: {
        messageId,
        sourceId,
        targetId,
        isResponse,
        traceId: meta.traceId,
        originId: meta.originId,
        isProbe,
      },
    });
  }

  private forwardOrComplete(meta: MessageMeta, message: Message): void {
    const node = this.getNode(message.targetId);
    const downstream = this.downstreamOf(message.targetId);

    if (node.type !== 'Database' && downstream.length > 0) {
      this.sendHop(message.targetId, downstream[0], meta, false);
      return;
    }

    node.stats.succeeded += 1;
    this.sendHop(message.targetId, message.sourceId, meta, true);
  }

  private completeTrace(traceId: string, originId: NodeId): void {
    this.activeTraces.delete(traceId);
    const origin = this.nodes.get(originId);
    if (origin) {
      origin.stats.succeeded += 1;
    }
  }

  private failMessage(message: Message, target: NodeState, meta: MessageMeta): void {
    message.status = 'FAILED';
    target.inFlight = Math.max(0, target.inFlight - 1);
    target.stats.failed += 1;
    target.consecutiveFailures += 1;

    if (
      target.circuit === 'CLOSED' &&
      target.consecutiveFailures >= target.config.cbFailureThreshold
    ) {
      this.openCircuit(target);
    }

    if (target.circuit === 'HALF_OPEN') {
      this.openCircuit(target);
    }

    this.scheduleRetry(meta, message);
  }

  private handleMessageTimeout(event: SimEvent): void {
    const messageId = event.payload.messageId as string;
    const message = this.messages.get(messageId);
    if (!message || message.status !== 'IN_FLIGHT') return;

    const target = this.getNode(message.targetId);
    const meta = this.messageMeta.get(messageId);
    if (!meta) return;

    this.failMessage(message, target, meta);
  }

  private scheduleRetry(meta: MessageMeta, message: Message): void {
    const caller = this.nodes.get(message.sourceId);
    if (!caller) {
      this.handleTraceFailure(meta.traceId, meta.originId, message.targetId, message.id);
      return;
    }

    if (message.retryCount < caller.config.retryBudget) {
      caller.stats.retried += 1;
      message.status = 'RETRYING';
      message.retryCount += 1;
      const jitter = this.prng();
      const backoff = computeBackoffMs(message.retryCount, jitter);
      this.enqueue({
        type: 'RETRY_SCHEDULED',
        virtualTime: this.virtualTime + backoff,
        payload: {
          messageId: message.id,
          sourceId: message.sourceId,
          targetId: message.targetId,
          traceId: meta.traceId,
          originId: meta.originId,
          isResponse: meta.isResponse,
        },
      });
    } else {
      this.handleTraceFailure(meta.traceId, meta.originId, message.targetId, message.id);
    }
  }

  private handleTraceFailure(
    traceId: string,
    originId: NodeId,
    _failedAt: NodeId,
    _messageId: string,
  ): void {
    this.activeTraces.delete(traceId);
    const origin = this.nodes.get(originId);
    if (origin) {
      origin.stats.failed += 1;
    }
  }

  private handleRetryScheduled(event: SimEvent): void {
    const messageId = event.payload.messageId as string;
    const message = this.messages.get(messageId);
    if (!message) return;

    message.status = 'IN_FLIGHT';
    this.enqueue({
      type: 'MESSAGE_SEND',
      virtualTime: this.virtualTime,
      payload: {
        messageId,
        sourceId: event.payload.sourceId,
        targetId: event.payload.targetId,
        isResponse: event.payload.isResponse,
        traceId: event.payload.traceId,
        originId: event.payload.originId,
      },
    });
  }

  private openCircuit(node: NodeState): void {
    node.circuit = 'OPEN';
    node.circuitOpenedAt = this.virtualTime;
    this.enqueue({
      type: 'CIRCUIT_PROBE',
      virtualTime: this.virtualTime + node.config.cbRecoveryTimeoutMs,
      payload: { nodeId: node.id },
    });
  }

  private handleCircuitProbe(event: SimEvent): void {
    const nodeId = event.payload.nodeId as NodeId;
    const node = this.nodes.get(nodeId);
    if (!node || node.circuit !== 'OPEN') return;

    node.circuit = 'HALF_OPEN';
    node.consecutiveFailures = 0;

    const downstream = this.downstreamOf(nodeId);
    const probeTarget = downstream[0] ?? nodeId;
    const probeId = createMessageId();
    this.messages.set(probeId, createMessage(nodeId, probeTarget, this.virtualTime));

    this.enqueue({
      type: 'MESSAGE_SEND',
      virtualTime: this.virtualTime,
      payload: {
        messageId: probeId,
        sourceId: nodeId,
        targetId: probeTarget,
        isResponse: false,
        traceId: createMessageId(),
        originId: nodeId,
        isProbe: true,
      },
    });
  }

  private handleFaultInject(event: SimEvent): void {
    const nodeId = event.payload.nodeId as NodeId | undefined;
    const edge = event.payload.edge as { source: NodeId; target: NodeId } | undefined;
    const faultType = event.payload.faultType as string;
    const latencyMs = (event.payload.latencyMs as number) ?? 500;

    if (edge && faultType === 'PARTITION') {
      this.partitions.add(edgeKey(edge.source, edge.target));
      return;
    }

    if (nodeId) {
      if (faultType === 'SLOW') {
        this.faults.set(nodeId, 'SLOW');
        this.slowFaults.set(nodeId, latencyMs);
      } else if (faultType === 'FAILED') {
        this.faults.set(nodeId, 'FAILED');
      }
    }
  }

  private handleFaultClear(event: SimEvent): void {
    const nodeId = event.payload.nodeId as NodeId | undefined;
    const edge = event.payload.edge as { source: NodeId; target: NodeId } | undefined;
    const faultType = event.payload.faultType as string | undefined;

    if (edge && faultType === 'PARTITION') {
      this.partitions.delete(edgeKey(edge.source, edge.target));
      return;
    }

    if (nodeId) {
      this.faults.delete(nodeId);
      this.slowFaults.delete(nodeId);
    }
  }

  private drainQueues(): void {
    for (const [nodeId, node] of this.nodes) {
      const queue = this.pendingQueues.get(nodeId) ?? [];
      while (node.inFlight < node.config.concurrencyLimit && queue.length > 0) {
        const item = queue.shift()!;
        node.queuedCount = queue.length;
        this.enqueue({
          type: 'MESSAGE_SEND',
          virtualTime: this.virtualTime,
          payload: {
            messageId: item.messageId,
            sourceId: item.sourceId,
            targetId: item.targetId,
            isResponse: item.isResponse,
            traceId: item.traceId,
            originId: item.originId,
          },
        });
      }
    }
  }
}

export function benchmarkSimulation(sim: Simulation, targetTime = 10_000): number {
  const start = performance.now();
  while (sim.getState().virtualTime < targetTime && sim.step()) {
    // process events as fast as possible
  }
  const elapsed = performance.now() - start;
  return Math.round((sim.getEventsProcessed() / elapsed) * 1000);
}
