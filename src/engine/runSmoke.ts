import { runSmokeTest } from './smoke';

const result = runSmokeTest();
console.log(result.message);
if (!result.pass) {
  throw new Error(result.message);
}
