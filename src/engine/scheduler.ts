import type { SimEvent } from './types';

function compareEvents(a: SimEvent, b: SimEvent): number {
  if (a.virtualTime !== b.virtualTime) {
    return a.virtualTime - b.virtualTime;
  }
  return a.id.localeCompare(b.id);
}

export class EventQueue {
  private heap: SimEvent[] = [];

  push(event: SimEvent): void {
    this.heap.push(event);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): SimEvent | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) {
      this.heap[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  peek(): SimEvent | undefined {
    return this.heap[0];
  }

  size(): number {
    return this.heap.length;
  }

  toArray(): SimEvent[] {
    return [...this.heap].sort(compareEvents);
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareEvents(this.heap[index], this.heap[parent]) >= 0) break;
      [this.heap[index], this.heap[parent]] = [this.heap[parent], this.heap[index]];
      index = parent;
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length;
    while (true) {
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      let smallest = index;

      if (left < length && compareEvents(this.heap[left], this.heap[smallest]) < 0) {
        smallest = left;
      }
      if (right < length && compareEvents(this.heap[right], this.heap[smallest]) < 0) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}
