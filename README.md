# CompileIt

A self-hosted developer playground for C, C++, Python, and Java. React + CodeMirror on the frontend; Express, a bounded execution queue, and optional Bull / Redis / MongoDB on the backend. No paid APIs, subscriptions, or API keys.

## What you can do

- Edit with syntax highlighting, autocomplete, line numbers, bracket matching, search, undo/redo, and focus mode.
- Switch languages without losing drafts; drafts autosave per language in the browser.
- Run code with standard input or import source and input files. Download source files.
- Add up to 10 test cases and compare expected output against actual output (normalizes CRLF and trailing whitespace only).
- Watch queued / running / completed states, timing, compiler diagnostics, stderr, and exit codes. Cancel queued or active runs.
- Restore source snapshots from the last 30 runs; keep up to 50 named snippets on your device.
- Share code and input through a URL fragment. Opening a link asks before replacing a draft. The recipient needs a running backend to execute it.
- Use light / dark themes, change font sizes, or use keyboard shortcuts.
- Capture a successful run as a regression test using its original input and output.
- Inspect failed tests side by side, locate the first different line / column, and reveal invisible spaces.
- Export / restore a validated portable workspace backup (drafts, input, tests, and snippets).
- Open Execution info for a plain-language explanation of the queue, live waiting / running counts, and storage locations.

## Quick local demo

Requires Node.js 20+, npm, and whichever runtimes you use: `g++`, `gcc`, `python3`, `javac`, and `java`. Java programs use `Main` as the main class.

```sh
cd backend
npm ci
npm start
```

In another terminal:

```sh
cd client
npm ci
npm start
```

Open **http://localhost:3000**. The API binds to **127.0.0.1:5001** by default. The in-memory FIFO queue needs no database and runs two jobs concurrently. Its results disappear on restart; it retains at most 100 finished jobs for at most 24 hours. Browser drafts and snippets persist across restarts.

**Local execution is for your own trusted code only.** It executes with your OS user's access; process deadlines are not a security sandbox. Use Docker execution for isolated jobs. The API is intentionally bound to loopback by default.

## Isolated execution with Docker

Use a free Docker Engine installation, or a Docker-compatible runtime such as Colima on macOS. Start the container engine, then:

```sh
cd backend
npm ci
npm run start:docker
```

`npm start` explicitly selects local execution without Docker. `npm run start:docker` checks the Docker engine, reuses `RUNNER_IMAGE` (default `compileit-runner`) if it exists, or builds it before starting the backend. If Docker is unavailable or the build fails, the backend does not start. These commands select execution mode regardless of an inherited `EXECUTION_MODE`; queue configuration remains independent. `npm run start:local` is an alias for local startup.

An existing image is not automatically rebuilt after runner changes. Run `npm run runner:build` to refresh the default image, or `docker build -t YOUR_IMAGE -f runner/Dockerfile .` from `backend` for a custom tag. This is local startup automation; it does not deploy anything.

Each execution creates a fresh restricted container with:

- No network and no host directory or Docker socket mounts.
- Non-root user, read-only root filesystem, dropped capabilities, and no new privileges.
- 384 MB memory, 1 CPU, 64 processes, and a 64 MB temporary workspace.
- A 15-second compilation deadline, 5 seconds per test / run, 128 KB combined output per process, and 90 seconds for the complete container lifecycle.
- Cleanup of temporary files and containers after execution, timeout, or cancellation.

The API host needs access to the Docker daemon. The runner image includes Node, GCC/G++, Python, and Java; no external code-execution service is called. Container isolation is defense in depth; this project is a local / self-hosted portfolio app, not a hardened public multi-tenant execution service. Public hosting would also need authentication, per-user quotas, TLS, operational monitoring, and a reviewed sandbox boundary.

## Persistent queue: Redis + MongoDB

From the project root:

```sh
docker compose up -d
```

Then, after building the runner image:

```sh
cd backend
npm run start:redis
```

Bull stores queue state in Redis, MongoDB stores submissions and results with 24-hour TTL cleanup, and Compose volumes preserve both across restarts. Worker concurrency defaults to two. Bull recovers stalled work; compile/runtime errors are terminal. Thrown infrastructure errors have up to three queue attempts with backoff. Redis mode uses a new queue name (`compileit-v2`) so old submissions are not mixed with the new worker contract.

The queue limit is 50 waiting jobs per service. The Redis admission check is best-effort under simultaneous submissions across multiple API instances. Rate limiting is per API instance (30 submissions/minute/IP); it is not a distributed quota.

## Configuration

See [backend/.env.example](backend/.env.example) and [client/.env.example](client/.env.example). To load backend configuration with Node 20:

```sh
cd backend
cp .env.example .env
node --env-file=.env index.js
```

The frontend reads `.env` through Create React App. Restart it after changing environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `EXECUTION_MODE` | `docker` for direct Node / worker startup | `npm start` selects `local`; `npm run start:docker` selects `docker` |
| `QUEUE_MODE` | `memory` | `memory` or persistent `redis` |
| `WORKER_CONCURRENCY` | `2` | Concurrent worker slots, bounded to 1–8 |
| `HOST` / `PORT` | `127.0.0.1` / `5001` | API listener |
| `CLIENT_ORIGIN` | `http://localhost:3000` | Comma-separated allowed browser origins |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/compilerdb` | MongoDB connection |
| `RUNNER_IMAGE` | `compileit-runner` | Locally built sandbox image |
| `REACT_APP_API_URL` | `http://localhost:5001` | Frontend API base URL |

## Where your data is stored

| Data | Where it lives |
| --- | --- |
| Language drafts, current input, test cases, preferences | This browser’s `localStorage` |
| Named snippets and last 30 runs (with source/input snapshots) | This browser’s `localStorage`, even in Redis mode |
| Uploaded source / input files | Read as text into the draft/input. Original files are not archived. Text follows the same storage rules as typed code/input. |
| Submitted job in memory mode | API process memory; finished results retained up to 24 hours, at most 100; everything disappears on restart |
| Submitted job in Redis mode | Source, input, tests, and results in MongoDB; TTL cleanup after 24 hours. Redis holds the job ID / queue state. |
| Files used by the compiler | Per-job temporary directory, removed after execution; inside the restricted container in Docker mode |
| Exported backup | A JSON file downloaded to your device; excludes run history |
| Shared snippet | Code/input encoded in the link’s fragment; not stored as a shared database record |

Browser storage is device/browser/origin-specific. Clearing site data deletes local drafts and snippets; export a backup from Settings before moving devices. Restoring a backup explicitly confirms replacement. MongoDB job storage is not snippet synchronization.

## Architecture

```text
React + CodeMirror ── POST /run ──► Express validation + rate limit
        │                                     │
        │                           Memory FIFO OR Bull / Redis
        │                                     │
        │                              Bounded worker pool
        │                                     │
        │                           Docker execution container
        │                           (compile → run → compare)
        │                                     │
        └── GET /status?id=… ◄── Memory results OR MongoDB
```

Execution uses argument arrays with `spawn`, never interpolated shell commands. Each submission gets its own directory; Java's `Main.java` is isolated from other jobs. Input is streamed through stdin, and stderr is preserved without incorrectly treating warnings as failures. Browser polling is sequential, bounded, and aborts on unmount. Code files are limited to 64 KB, input to 64 KB, and test suites to ten cases. File uploads use bounded memory storage.

The original `/run` (including multipart `codeFile` / `inputFile`) and `/status?id=…` routes remain supported. The legacy executor helper files remain for reference; the active worker uses `runner.js`.

## API

| Method | Endpoint | Result |
| --- | --- | --- |
| `POST` | `/run` | `201 { jobId }`; accepts `{ language, code, input, testCases }` |
| `GET` | `/status?id=…` | `{ success, job }`, including status, output, diagnostics, timing, and test results |
| `DELETE` | `/jobs/:id` | Cancel a queued or running submission |
| `GET` | `/health` | API status, execution mode, and queue metrics |
| `GET` | `/queue` | Queue counts and configured concurrency |

Job IDs act as unguessable capability identifiers. There are no user accounts or ownership boundaries. Results do not expose source code or host paths. Error messages generated by compilers can contain paths inside temporary execution directories.

## Verification

```sh
cd backend
npm ci
npm test

cd ../client
npm ci
CI=true npm test -- --watchAll=false --runInBand
npm run build
```

Backend tests exercise FIFO ordering, backpressure, concurrency, cancellation, process deadlines, output caps, Python stdin / test comparisons, multipart compatibility, validation, and rate limiting. Frontend tests cover draft preservation, execution results, history, test submission, and snippets. CI repeats these checks on Ubuntu. Full Docker and Redis integration requires running those services; unit tests do not substitute for that check.

```sh
cd backend
npm run runner:build
npm run test:docker
# Use dedicated local test services / database for this check:
EXECUTION_MODE=local REDIS_URL=redis://127.0.0.1:16379 MONGODB_URI=mongodb://127.0.0.1:17017/compileit_test npm run test:redis
```

Frontend coverage also includes regression-capture snapshots, backup validation / round trips, and output difference detection.

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Run code | Cmd + Enter | Ctrl + Enter |
| Run all tests | Cmd + Shift + Enter | Ctrl + Shift + Enter |
| Save snippet | Cmd + S | Ctrl + S |
| Show shortcuts | Cmd + K | Ctrl + K |
| Find in editor | Cmd + F | Ctrl + F |
| Exit focus / close dialog | Esc | Esc |

## Design research and cost

[Judge0](https://judge0.com/) informed the separate submission/result model, detailed execution feedback, and resource limits. [OneCompiler](https://onecompiler.com/about) informed custom input, sharing, and reusable code examples. [Bull's documentation](https://github.com/OptimalBits/bull) informed the persistent queue and bounded worker concurrency. [Docker's resource guidance](https://docs.docker.com/engine/containers/resource_constraints/) informed CPU and memory limits.

The implementation uses free software and runs on your own machine. Hosting compute is separate and is not promised to be free. No hosted compiler API, paid AI feature, or paid queue dashboard is required. Google Fonts are optional presentation assets; system fonts work when offline.

## Portfolio talking points

- Designed a responsive IDE with CodeMirror, persistent per-language drafts, source snapshots, share links, and test-case evaluation.
- Implemented asynchronous execution with bounded concurrency, queue backpressure, cancellation, and a Redis-backed persistence option.
- Isolated code execution with Docker resource restrictions, per-job workspaces, process timeouts, output caps, and deterministic cleanup.
- Preserved multipart API compatibility and added integration tests for queue behavior, execution failures, and request validation.

Describe these as implemented capabilities; do not claim production scale or benchmark numbers without measuring them.

## Recovery, duplicate handling, and load measurement

See [docs/verification/README.md](docs/verification/README.md) for meanings, reproducible commands, the test workload, and result limitations. JSON reports contain actual run results, including raw request timings.

- `POST /run` accepts an optional `Idempotency-Key` header. Identical keyed retries return the same job ID; reusing a key with different code/input/tests returns HTTP 409. MongoDB enforces a unique key per queue. Key retention follows the job's 24-hour TTL; memory-mode keys disappear with retained jobs. Keys are caller-supplied identifiers, not authentication.
- The browser retries one failed submission response with the same key.
- Workers use atomic MongoDB claims, renewable leases, and per-attempt ownership tokens. Stale workers cannot replace a newer result. Completed/cancelled jobs ignore duplicate queue deliveries.
- Bull redelivers stalled work. Recovery may execute a crashed program again: delivery is at least once, with one accepted result per job, rather than exactly-once program side effects.
- A reconciler recovers pending MongoDB records left behind if an API process dies before adding the Redis message. This covers the insert/enqueue gap; Redis and MongoDB are not a shared transaction.
- Graceful worker shutdown drains active work. Hard crashes require stalled-job recovery. Docker attempts use persisted container names so a replacement worker can remove its predecessor's orphaned container. Local mode is trusted-code-only and cannot safely clean arbitrary orphaned host processes after SIGKILL.

To run API and workers separately while keeping existing combined mode available:

```sh
cd backend
QUEUE_MODE=redis PROCESS_JOBS=false node index.js
# Another terminal, using the same Redis / MongoDB settings:
WORKER_CONCURRENCY=1 npm run worker
# Start another worker process to add execution slots.
```

The benchmark compares one and two separate worker processes through the actual HTTP API, Redis, and MongoDB. It retains the default API rate limit, records successful throughput, rejected/failed jobs, admission latency, queue wait, execution time, and p50/p95/p99 completion latency. Reports clearly identify local or Docker execution mode. The Linux integration workflow runs sandbox and recovery suites with real services; authored CI is not evidence of a CI run until executed.

## Current verification

The local and Docker recovery suites passed hard-crash recovery, keyed request retries, duplicate delivery, stale-write rejection, missing-enqueue reconciliation, cancelled-job replay, and graceful shutdown. The Docker suite passed all four runtimes, filesystem/network isolation, cancellation cleanup, time/output limits, memory pressure, temporary-disk limits, and process fan-out. Reports are in `docs/verification/docker.json`, `recovery-local.json`, and `recovery-docker.json`.

The prior Python startup problem was resolved by rebuilding the compiler image from fresh installation layers after restoring disk space and restarting the stuck engine. The runner build now checks runtime startup so a broken image cannot silently pass the build. Docker verification is a test of the configured boundaries, not a full security audit. The GitHub integration workflow is authored; a remote CI execution is not claimed.

See [all measured timings](docs/verification/measurements.md) for benchmark results, definitions, and limitations. Traffic is generated by scripted HTTP clients against actual services. These measurements are synthetic local benchmarks, not real-user production traffic or a maximum-capacity guarantee.
