import { runFrameBudgetTest, runSpeedTest } from './speedTest';

const result = runSpeedTest();
console.log(result.message);
if (!result.pass) throw new Error(result.message);

const frameResult = runFrameBudgetTest();
console.log(frameResult.message);
if (!frameResult.pass) throw new Error(frameResult.message);
