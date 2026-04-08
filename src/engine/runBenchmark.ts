import { runBenchmark } from './benchmark';

const eps = runBenchmark();
console.log(`Benchmark: ${eps.toLocaleString()} events/sec`);
