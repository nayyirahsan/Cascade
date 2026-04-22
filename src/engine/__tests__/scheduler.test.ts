import { describe, expect, it } from 'vitest';
import { EventQueue } from '../scheduler';
import { createPrng } from '../prng';
import type { SimEvent } from '../types';

function makeEvent(seq: number, virtualTime: number): SimEvent {
  return { id: `evt-${seq}`, seq, type: 'MESSAGE_SEND', virtualTime, payload: {} };
}

describe('EventQueue (min-heap)', () => {
  it('pops events in ascending virtualTime order', () => {
    const q = new EventQueue();
    const prng = createPrng(1234);
    const times: number[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const t = Math.floor(prng() * 10_000);
      times.push(t);
      q.push(makeEvent(i, t));
    }
    times.sort((a, b) => a - b);

    const popped: number[] = [];
    for (let i = 0; i < 1000; i += 1) {
      popped.push(q.pop()!.virtualTime);
    }
    expect(popped).toEqual(times);
    expect(q.pop()).toBeUndefined();
  });

  it('breaks timestamp ties by insertion sequence (FIFO)', () => {
    const q = new EventQueue();
    // Insert seqs out of order at the same timestamp, including seq >= 10 to
    // catch lexicographic comparison bugs ("evt-10" < "evt-2").
    const seqs = [12, 3, 10, 1, 25, 2, 11];
    for (const seq of seqs) q.push(makeEvent(seq, 500));

    const popped: number[] = [];
    while (q.size() > 0) popped.push(q.pop()!.seq);
    expect(popped).toEqual([1, 2, 3, 10, 11, 12, 25]);
  });

  it('interleaves pushes and pops without violating ordering', () => {
    const q = new EventQueue();
    const prng = createPrng(99);
    let lastPopped = -Infinity;
    let seq = 0;
    for (let round = 0; round < 200; round += 1) {
      const pushes = 1 + Math.floor(prng() * 5);
      for (let i = 0; i < pushes; i += 1) {
        seq += 1;
        // Never schedule in the past relative to what we've already popped.
        q.push(makeEvent(seq, Math.max(lastPopped, 0) + Math.floor(prng() * 100)));
      }
      const pops = Math.floor(prng() * pushes);
      for (let i = 0; i < pops && q.size() > 0; i += 1) {
        const e = q.pop()!;
        expect(e.virtualTime).toBeGreaterThanOrEqual(lastPopped);
        lastPopped = e.virtualTime;
      }
    }
  });
});
