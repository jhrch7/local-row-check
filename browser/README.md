# Offline browser edition

Download **rowcheck-offline.html** from the
[1.3.0 release](https://github.com/jhrch7/local-row-check/releases/tag/v1.3.0).
Save the file and open it in a current Chromium browser. It is a complete local
file: no server, Python, installation, sign-in or network connection is needed.

The [online project demo](https://jhrch7.github.io/local-row-check/) serves an
identical copy of the standalone tool. GitHub logs page visits; the comparison
code makes no file-upload or analytics requests. Use the download for fully
offline work. Rebuilding also synchronizes the tool and actual preview into
`docs/`, the project site's publishing directory.

1. Try the catalogue or multi-column synthetic example, or choose a left and
   right CSV file.
2. Choose the delimiter used in both files: comma, semicolon or tab.
3. Choose the exact key header shared by both files. To match on a combination
   such as SKU + Warehouse, select **Add key column** and choose another header.
   Choose every key before comparing. Optionally select non-key value columns.
   Changing a choice clears the old report and download.
4. Select **Compare files**. Review the counts and the report previews.
5. Select **Download report ZIP** and keep it private.

The ZIP contains the four key reports described in the repository README,
`value_changes.csv` if value columns were selected, and `manifest.json` with
source/output SHA-256 hashes and byte sizes. Previews show the original values;
CSV downloads prefix formula-like cells with an apostrophe, just like the CLI.
Record numbers count CSV data records, not physical lines. The source files are
never modified.

With multi-column keys, a blank component sends the row to review. A duplicated
complete combination sends all its rows on both sides to review. Matching never
joins components with a delimiter. Keys in downloaded reports are compact JSON
arrays, for example `["A","North"]`, and `key_columns` in the manifest records
their order. Single-column reports keep the existing scalar key format.
The included warehouse example has five unique shared combinations, five review
rows across both inputs, and three changed cells.

## Deliberate limits

- UTF-8 input, with or without a BOM; up to **2 MiB and 50,000 data records per
  input**. Choose the same delimiter for both files.
- **Exact keys only.** No trimming, Unicode case-folding, fuzzy matching or
  numeric/date/currency conversion. Use the Python CLI when you deliberately
  need its other key-normalisation or input-encoding choices.
- Headers must be nonempty and unique. Blank records, incorrect field counts,
  unclosed quotes, NUL characters and invalid UTF-8 are rejected.
- Every row in an ambiguous key group goes to review, including a lone row on
  the other side. No guessed pairing or automatic data correction.
- Shared keys alone do not establish identity. No selected value changes does
  not mean every column agrees. Review the output before business changes.
- Data remains in page memory; there is no local/session storage, service worker,
  telemetry or application network code. **Clear selections and report** drops
  the app's current references and hides its results. This is not a secure-erasure
  guarantee. Downloaded reports remain on your device.
- The file uses the File API and Web Crypto. The exercised browser is Chrome
  156.0.8078.80 on macOS at 1280px and 390px viewports. Other browsers, operating
  systems and physical phones have not been exercised for this edition.

The source and offline file are free under the MIT licence. The existing
[optional A$40 CSV-comparison pilot](https://github.com/jhrch7/csv-comparison-pilot)
retains its separate scope, availability, turnaround and payment agreement.
This release establishes no paid order or earnings.

## Build and verify

No third-party packages are required. Source changes live in `browser/`; the
downloadable HTML embeds exactly those files and both synthetic examples.

```sh
python3 -B browser/build.py
node --test browser/core.test.cjs
python3 -B browser/check_parity.py --work-dir /your/new/task-owned/parity-directory
node browser/check_ui.cjs --chrome /path/to/Chrome --work-dir /your/new/task-owned/ui-directory
node browser/check_ui.cjs --chrome /path/to/Chrome --work-dir /your/new/task-owned/site-check --site-url https://jhrch7.github.io/local-row-check/
```

The parity check uses the Python engine as the oracle for thirteen named
boundary cases, comparing every generated CSV byte/hash, counts, metadata and
ZIP integrity. Browser tests exercise the actual file, local file inputs,
examples, previews, downloads, add/remove key controls, invalidation, pending-read
and pending-report reset, and reload.
`check_ui.cjs` creates a **new isolated headless profile**, closes its own browser
and removes only that profile. It does not access an existing browser session.
Logs, synthetic downloads and screenshots remain in the new work directory.
The optional site check uses this project's public Pages site, verifies that its
HTML download matches the standalone file, and allows only the declared project
GET resources. It does not use an account or an existing browser session.

The ten core tests and thirteen parity cases passed with Node 24.17.0 and Python
3.14.6 on macOS. Compound-key cases cover delimiter collisions, Unicode and
escaped-component sorting, blank components, duplicated combinations and
header-only inputs. Single-key CSV outputs were also checked against the old
Python engine on nine cases. Browser screenshots were inspected; this is automated verification
of the declared behavior, not an independent security audit or an adoption claim.
