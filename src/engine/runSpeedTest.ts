import { runSpeedTest } from './speedTest';

const result = runSpeedTest();
console.log(result.message);
if (!result.pass) throw new Error(result.message);
