# Measured performance and Docker verification

These are synthetic load measurements made by sending actual HTTP requests through Express, Redis, MongoDB, and execution workers. They are not estimates from code inspection and are not measurements of real users. Each configuration has 30 requests and eight concurrent closed-loop clients, with one execution slot per worker. The workload sleeps 100 ms, sums 10,000 integers, and prints the sum. The machine is an Apple M2 with 8 logical CPUs and 8 GB RAM, running Node 20.16.0. Docker runs inside Docker Desktop’s Linux VM on macOS.

| Mode | Workers | Submitted / accepted / correct | Rejected | Request errors | Failed jobs | Failure rate | Elapsed (s) | Successful jobs/s |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| local | 1 | 30 / 30 / 30 | 0 | 0 | 0 | 0.00% | 4.35 | 6.90 |
| local | 2 | 30 / 30 / 30 | 0 | 0 | 0 | 0.00% | 2.08 | 14.42 |
| docker | 1 | 30 / 30 / 30 | 0 | 0 | 0 | 0.00% | 10.75 | 2.79 |
| docker | 2 | 30 / 30 / 30 | 0 | 0 | 0 | 0.00% | 6.25 | 4.80 |

All timings below are milliseconds. Each statistic is computed from the completed observations; raw request records and UTC timestamps are in the JSON files. p50 is the median, p95 is the 95th-percentile nearest-rank value, and p99 is the 99th-percentile value. With only 30 observations, p99 is the slowest observed value and is not a robust tail-latency estimate.

| Mode | Workers | Measurement | Mean | p50 | p95 | p99 |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| local | 1 | API admission | 49.38 | 7.03 | 179.41 | 197.73 |
| local | 1 | Client-observed completion | 1023.16 | 1070.72 | 1204.14 | 1378.78 |
| local | 1 | Server-recorded completion | 954.53 | 1030.00 | 1104.00 | 1154.00 |
| local | 1 | Queue wait | 818.60 | 895.00 | 973.00 | 1015.00 |
| local | 1 | Program execution | 132.43 | 128.00 | 164.00 | 203.00 |
| local | 2 | API admission | 7.17 | 6.10 | 13.57 | 15.97 |
| local | 2 | Client-observed completion | 496.17 | 545.55 | 585.08 | 587.65 |
| local | 2 | Server-recorded completion | 463.47 | 502.00 | 536.00 | 536.00 |
| local | 2 | Queue wait | 330.83 | 369.00 | 402.00 | 403.00 |
| local | 2 | Program execution | 129.47 | 130.00 | 132.00 | 133.00 |
| docker | 1 | API admission | 17.87 | 4.69 | 60.97 | 63.37 |
| docker | 1 | Client-observed completion | 2487.66 | 2500.90 | 3172.23 | 3496.47 |
| docker | 1 | Server-recorded completion | 2450.33 | 2461.00 | 3116.00 | 3415.00 |
| docker | 1 | Queue wait | 2097.00 | 2154.00 | 2764.00 | 3110.00 |
| docker | 1 | Program execution | 115.57 | 113.00 | 142.00 | 146.00 |
| docker | 2 | API admission | 8.27 | 4.60 | 21.24 | 21.78 |
| docker | 2 | Client-observed completion | 1488.70 | 1580.25 | 1751.02 | 1821.36 |
| docker | 2 | Server-recorded completion | 1452.90 | 1536.00 | 1709.00 | 1765.00 |
| docker | 2 | Queue wait | 1044.13 | 1153.00 | 1321.00 | 1323.00 |
| docker | 2 | Program execution | 114.80 | 112.00 | 127.00 | 135.00 |

API admission is POST-to-job-ID response time. Client-observed completion is submission-to-terminal-status observation, including 50 ms polling. Server completion uses submitted/completed timestamps. Queue wait ends at the successful attempt’s claim. Program execution uses the execution result timer; in Docker mode it is measured inside the container and therefore excludes container startup and cleanup. The remainder of server completion includes those costs and persistence overhead. Stage means/percentiles are measured separately and must not be subtracted as if percentile samples were additive.

The quoted earlier progress sample (7.04/14.22 jobs per second) differs slightly from the retained final local report (6.90/14.42). Separate trials naturally vary. These reports are individual local samples, have no warm-up, retain production API rate limits, and do not prove maximum capacity, performance under CPU-heavy C++ compilation, or real-user availability. Zero failures in 30 jobs means zero failures observed in that sample.

Docker is used to isolate submitted code, cap resources, and provide consistent compilers. Without isolation, local code execution inherits host-user access and can read/write host files or consume unbounded memory. Trusted personal code can use local mode. A public compiler needs an isolation boundary; Docker supplies useful controls with startup overhead. Configuration and controlled tests are defense in depth, not a complete security audit.

Docker verification passed eleven runtime/isolation/resource checks and eight worker-recovery checks. The Docker benchmark completed all 60 submitted jobs correctly with no rejected requests, client request errors, or failed jobs. Engine version 28.5.1 and the runner image identity are stored in `benchmark-docker.json`. Docker Desktop configured eight CPUs and approximately 3.83 GB VM memory; each runner had a one-CPU quota and 384 MB memory limit. These are limits, not peak-utilization measurements. We did not measure peak CPU/RAM usage, Internet latency, CPU-heavy compilation throughput, sustained capacity, or real-user uptime.
