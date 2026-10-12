# Reliability and performance evidence

These files are results from actual test runs. UTC timestamps are embedded in the JSON. Local figures are samples from the listed machine and workload, not public-service capacity guarantees.

## Plain-language meanings

1. **Recovery and duplicate handling:** a worker is the process that runs submitted code. If it crashes, another worker takes over unfinished work. Retried HTTP requests and redelivered queue messages should not create extra jobs or overwrite a finished result. The queue has **at-least-once delivery**: a crashed program can execute again. Ownership tokens protect the accepted result; they do not make a program's external side effects exactly-once.
2. **Load measurement:** many clients submit programs together. **Throughput** is successful jobs per second; **queue wait** is time from submission to the successful attempt starting; **failure rate** is the percentage of accepted jobs that fail; **p95 latency** is the completion time at or below which 95% of measured jobs finish. End-to-end latency includes submission, queueing, execution, and observing completion. The reports also separate admission, server timestamps, queue wait, and execution.
3. **Docker verification:** test that programs run within container boundaries. The suite exercises four languages, disabled networking, non-root execution, read-only root filesystem, no host mounts or Docker socket, cancellation and cleanup, infinite-loop deadlines, output limits, temporary-disk limits, memory pressure, and process fan-out. CPU/memory/PID configuration is also inspected on a live container. Passing tests demonstrate those controls, not immunity to every container escape.

## Reproduce

Requires Node 20, Redis, MongoDB, and local runtimes for local mode, or a working Docker engine and the built runner image for Docker mode. Use dedicated test databases; the recovery and benchmark scripts refuse database names without `test` or `benchmark`.

```sh
cd backend
npm ci
# Start dedicated Redis / MongoDB instances first; adjust these URLs for your test services.
export REDIS_URL=redis://127.0.0.1:16379
export MONGODB_URI=mongodb://127.0.0.1:17017/compileit_test
EXECUTION_MODE=local npm run test:recovery

npm run runner:build
npm run test:docker
EXECUTION_MODE=docker npm run test:recovery

MONGODB_URI=mongodb://127.0.0.1:17017/compileit_benchmark EXECUTION_MODE=local npm run benchmark
MONGODB_URI=mongodb://127.0.0.1:17017/compileit_benchmark EXECUTION_MODE=docker npm run benchmark
```

The benchmark sends 30 jobs with eight closed-loop HTTP clients. Each Python job sleeps for 100ms, sums 10,000 integers, and prints the sum. It compares one and two separate worker processes, each with one execution slot. Real Redis/MongoDB and production API validation/rate limiting are enabled. A client waits for completion before submitting its next job. Status is sampled every 50ms; observed p95 includes that sampling delay. There is no warm-up. This workload is useful for measuring queue/concurrency overhead, but is not a compiler-heavy or CPU-bound capacity test. Small samples and an unrelated workload can yield different numbers.

Environment controls: `BENCH_REQUESTS` (1–30), `BENCH_CLIENTS` (1–30), `BENCH_WORKERS` (comma-separated counts, each 1–8). Each scenario uses its own queue and a fresh API limiter. Test documents expire after 24 hours. Reports preserve per-request records including rejected requests and incorrect outputs.

## Current results

Successful local results are in `recovery-local.json` and `benchmark-local.json`. Docker isolation and resource tests passed (`docker.json`), as did all eight Docker worker-recovery checks (`recovery-docker.json`). The initial Python startup failure was resolved by a fresh image rebuild after restoring disk space and restarting the stuck engine. The Linux integration workflow executes the same suites, but a remote CI run is not claimed. See [all measurements](measurements.md) for the full timing tables.

Resume wording should identify synthetic benchmark conditions and execution mode. Both local and Docker-backed benchmark reports are now available; neither is a production capacity measurement.

Latest successful local sample (30 requests per configuration, 8 clients, Apple M2, Node 20.16.0):

| Worker processes | Successful jobs/s | p95 observed completion | p95 queue wait | Failed accepted jobs |
| --- | ---: | ---: | ---: | ---: |
| 1 | 6.90 | 1,204 ms | 973 ms | 0 / 30 |
| 2 | 14.42 | 585 ms | 402 ms | 0 / 30 |

The recovery suite also verified graceful shutdown: an active job finished successfully before its owner stopped. Backend and frontend regression suites each passed nine tests; the frontend production build passed.

Docker-backed sample (same 30-job Python workload and eight clients):

| Worker processes | Successful jobs/s | p95 observed completion | p95 queue wait | Failed accepted jobs |
| --- | ---: | ---: | ---: | ---: |
| 1 | 2.79 | 3,172 ms | 2,764 ms | 0 / 30 |
| 2 | 4.80 | 1,751 ms | 1,321 ms | 0 / 30 |

Docker Engine 28.5.1 ran inside Docker Desktop's Linux VM with eight configured CPUs and approximately 3.83 GB engine memory. Each runner was restricted to a one-CPU quota and 384 MB memory. These are configuration limits, not measurements of peak CPU/RAM usage. Container startup and cleanup add overhead; program execution timings in the report are measured inside the container. Full mean/p50/p95/p99 tables and methodology are in [measurements.md](measurements.md).

All eleven Docker runtime/isolation/resource checks and all eight Docker recovery checks passed. No project-labeled compiler containers remained after verification and benchmarking. The old Python image startup failure was resolved by a clean image rebuild. Remote CI is still not claimed as executed.
