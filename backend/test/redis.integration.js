// Run against dedicated test services: REDIS_URL=... MONGODB_URI=... npm run test:redis
const assert = require('node:assert/strict');
const { createRedisService } = require('../jobQueue');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function completed(service, id) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const job = await service.get(id); if (!['pending', 'running'].includes(job.status)) return job; await wait(100); }
  throw new Error('Timed out waiting for Redis job');
}
(async () => {
  let service = await createRedisService({ concurrency: 1 });
  try {
    const id = await service.submit({ language: 'py', code: 'print(input().upper())', input: 'persistent queue' });
    const result = await completed(service, id); assert.equal(result.output, 'PERSISTENT QUEUE\n'); assert.equal(result.status, 'success'); assert.equal(result.code, undefined);
    const running = await service.submit({ language: 'py', code: 'import time\ntime.sleep(4)' });
    await wait(250);
    const waiting = await service.submit({ language: 'py', code: 'print("should not run")' });
    assert.equal((await service.get(waiting)).status, 'pending');
    assert.equal((await service.cancel(waiting)).status, 'cancelled');
    await service.cancel(running); assert.equal((await completed(service, running)).status, 'cancelled');
    await service.close(); service = await createRedisService({ concurrency: 1 });
    assert.equal((await service.get(id)).output, 'PERSISTENT QUEUE\n');
    console.log('Redis integration passed: execution, pending/active cancellation, and persistence across service restart.');
  } finally { await service.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
