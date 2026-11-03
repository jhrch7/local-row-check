# Measured CLI baseline — 3 November 2026

This measures the existing in-memory CLI at source `35aca7f7581558f26bde9f349432a3a9c44c3bd1`, CLI version 1.1.0.
The browser edition is separately versioned. No comparison-engine code changed.

## Observed results

| Data records in each input | Combined input bytes | CLI elapsed seconds | Peak resident memory (MiB) |
| ---: | ---: | ---: | ---: |
| 10,000 | 1,098,268 | 0.168 | 45.4 |
| 100,000 | 10,982,068 | 1.197 | 262.7 |

Both runs exited 0. Each input had half its keys shared and half unique to its
side, no review records, and a changed quantity for every shared key. All five
output CSV lengths and SHA-256 hashes matched their manifests. The corresponding
input and output hashes, expected counts and exact measurements are in
[the results file](2026-11-03-results.json).

Environment: macOS 26.5.2, arm64, Python 3.14.6. The time measurement
covers the CLI command in a fresh Python process; peak memory is macOS
`/usr/bin/time -l` maximum resident set size, converted using 1 MiB = 1,048,576 bytes.
The CLI source SHA-256 was `c7bb1df6faa02aa772f93f39338c837010dffacdfa83fe7c27446b2a4a916cfc`.

## Reproduce the inputs

From a checkout of the pinned source, run this Python snippet once in a directory
where `bench-work` does not exist. It writes synthetic data only.

```python
from pathlib import Path
import csv

root = Path("bench-work")
root.mkdir(exist_ok=False)
for n in (10_000, 100_000):
    case = root / str(n)
    case.mkdir()
    for side, start in (("left", 0), ("right", n // 2)):
        with (case / f"{side}.csv").open("w", encoding="utf-8-sig", newline="") as f:
            writer = csv.writer(f, lineterminator="\n")
            writer.writerow(["ID", "region", "quantity", "status", "note"])
            for i in range(start, start + n):
                writer.writerow([f"R{i:09d}", f"r{i % 7}",
                                 str(i % 100 + (side == "right")), "active",
                                 "synthetic batch, UTF-8 café"])
```

Then run these macOS commands from the repository root. Every report directory
must be new; no existing output is overwritten.

```sh
/usr/bin/time -l python3 rowcheck.py bench-work/10000/left.csv bench-work/10000/right.csv --key ID --compare-columns quantity --out bench-work/10000/report
/usr/bin/time -l python3 rowcheck.py bench-work/100000/left.csv bench-work/100000/right.csv --key ID --compare-columns quantity --out bench-work/100000/report
```

## Limits

There was one observed run per size. Inputs had been written immediately before
the command, so this is not a cold-disk test, a timing guarantee or a repeated-run
median. Other applications, hardware, Python versions and cache state can change
the results. The fixtures have five columns, unique keys, short fields, and
50% overlap; large duplicate groups, blank keys and long fields were not measured.
Linux, other input sizes and a disk-backed implementation were not measured.

The current CLI already handles this fixture quickly; its memory cost is shown
rather than extrapolated to an untested size. This is not a general capacity
limit. The browser's documented 2 MiB / 50,000-record-per-input limits are unchanged.
Keep real CSV data and report files private.
