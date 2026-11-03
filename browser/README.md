# Offline browser edition

Download **rowcheck-offline.html** from the
[1.2.0 release](https://github.com/jhrch7/local-row-check/releases/tag/v1.2.0).
Save the file and open it in a current Chromium browser. It is a complete local
file: no server, Python, installation, sign-in or network connection is needed.

1. Try the included synthetic example, or choose a left and right CSV file.
2. Choose the delimiter used in both files: comma, semicolon or tab.
3. Choose the exact key header shared by both files. Optionally select non-key
   value columns. Changing a choice clears the old report.
4. Select **Compare files**. Review the counts and the report previews.
5. Select **Download report ZIP** and keep it private.

The ZIP contains the four key reports described in the repository README,
`value_changes.csv` if value columns were selected, and `manifest.json` with
source/output SHA-256 hashes and byte sizes. Previews show the original values;
CSV downloads prefix formula-like cells with an apostrophe, just like the CLI.
Record numbers count CSV data records, not physical lines. The source files are
never modified.

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
  156.0.8078.74 on macOS at 1280px and 390px viewports. Other browsers, operating
  systems and physical phones have not been exercised for this edition.

The source and offline file are free under the MIT licence. The existing
[optional A$40 CSV-comparison pilot](https://github.com/jhrch7/csv-comparison-pilot)
retains its separate scope, availability, turnaround and payment agreement.
This release establishes no paid order or earnings.

## Build and verify

No third-party packages are required. Source changes live in `browser/`; the
downloadable HTML embeds exactly those files and the existing synthetic example.

```sh
python3 -B browser/build.py
node --test browser/core.test.cjs
python3 -B browser/check_parity.py --work-dir /your/new/task-owned/parity-directory
node browser/check_ui.cjs --chrome /path/to/Chrome --work-dir /your/new/task-owned/ui-directory
```

The parity check uses the existing Python engine as the oracle for nine named
boundary cases, comparing every generated CSV byte/hash, counts, metadata and
ZIP integrity. Browser tests exercise the actual file, local file inputs,
example, previews, downloads, invalidation, pending-read reset and reload.
`check_ui.cjs` creates a **new isolated headless profile**, closes its own browser
and removes only that profile. It does not access an existing browser session.
Logs, synthetic downloads and screenshots remain in the new work directory.

The seven core tests and nine parity cases passed with Node 24.17.0 and Python
3.14 on macOS. Browser screenshots were inspected; this is automated verification
of the declared behavior, not an independent security audit or an adoption claim.
