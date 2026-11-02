# Local Row Check

Compare two CSV exports on your computer. Find keys that appear in only one file,
and review blank or duplicate keys separately. Nothing is uploaded. No account,
AI service or third-party Python package is needed to run it.

The source, guide, examples and tests are free under the MIT licence.
Download the [source ZIP](https://github.com/jhrch7/local-row-check/archive/refs/heads/main.zip)
or clone this repository.

For a small comparison handled for you, the optional
[CSV-comparison pilot](https://github.com/jhrch7/csv-comparison-pilot) has an
indicative A$40 total price. It covers two non-sensitive CSVs within its stated
limits. Scope, availability, delivery, turnaround and payment are agreed before
any order. Running the tool yourself is free.

## Start here

Requires Python 3.9 or later and two CSV files with a common key column. This
release was exercised on macOS with Python 3.14. Windows and Linux have not been
observed in this release's verification.

1. Unzip the source download, or clone the repository.
2. Open a terminal in the unzipped folder.
3. Run the included example:

```sh
python3 rowcheck.py examples/left.csv examples/right.csv --key "Contact Name" --out example-report
```

On Windows, use `py -3` in place of `python3` if that is your Python command.
The command prints counts and creates `example-report`. Open `manifest.json` to
check the counts and `review.csv` for rows requiring a decision.

To compare your own exports:

```sh
python3 rowcheck.py "first export.csv" "second export.csv" --key "Customer ID" --out "new report"
```

Use a unique, stable identifier when available. A shared name alone does not prove
that two rows describe the same person. This tool compares strings; it makes no
identity judgement and does not check whether non-key columns agree.

## The four reports

| File | Meaning |
|---|---|
| `only_left.csv` | Rows whose unique key occurs only in the first input |
| `only_right.csv` | Rows whose unique key occurs only in the second input |
| `review.csv` | All rows with a blank key or a key duplicated in either input |
| `shared_keys.csv` | Keys occurring exactly once in each input, with source record numbers |

`manifest.json` records source hashes, column names, output hashes and row counts.
For each side: **input = only + shared + review**. A source record number starts
at 1 after the header and counts CSV records, not physical lines. A quoted field
may contain a newline without becoming two records.

Every row in a duplicated-key group goes to review, including the corresponding
row from the other file. Duplicate rows are not silently discarded or counted as
a resolved match. The review file retains original row values inside a JSON cell.

## Choose comparison rules deliberately

The default is exact, case-sensitive text. `Alex`, `alex` and `Alex ` differ.
Only choose a broader rule if it is right for your data:

```sh
python3 rowcheck.py left.csv right.csv --key "Contact Name" --normalise trim --out trimmed-report
python3 rowcheck.py left.csv right.csv --key "Contact Name" --normalise fold --out folded-report
```

- `none`: exact text; the default.
- `trim`: remove leading and trailing whitespace.
- `fold`: Unicode NFKC normalization, collapse whitespace and case-fold. This can
  make different original strings equal; inspect the shared-key report.

Whitespace-only keys always require review. There is no fuzzy matching,
accent stripping, enrichment or automatic correction.

## File formats and privacy

Export Excel or Google Sheets files as CSV first. `.xlsx` workbooks, PDFs and
Google account connections are not supported. The two files can have different
non-key columns. Headers must be nonempty and unique. Malformed-width records,
NUL characters, undecodable text and fields over 10 MiB are rejected. The files
are read into memory, so keep exports small enough for your computer.

The default input is comma-separated UTF-8, with an optional BOM. For
semicolon-separated exports add `--delimiter ';'`. If necessary, choose the actual
input encoding, for example `--encoding cp1252`. Encoding selection does not
repair a damaged export. Output CSVs are UTF-8 with BOM.

Original files are opened only for reading. Reports contain your data too:
keep the report directory private. The tool has no network code or telemetry.

Formula-like cells in generated CSVs are prefixed with an apostrophe to reduce
spreadsheet formula execution risk. This deliberately changes their CSV text
representation. The manifest counts those cells. Use your unchanged input files
as the authority for original values. Re-saving or stripping the prefix in a
spreadsheet can remove that protection.

## Troubleshooting

The output directory must be new. Choose another name for each run; existing
reports are never overwritten. The output directory's parent must exist.

An error returns exit code 2 and a reason on standard error. Invalid inputs fail
before the output directory is created. A disk/write failure can leave a partial
directory, including an incomplete manifest if its final write fails. Require a
successful exit, a complete parseable `manifest.json`, and output bytes matching
its recorded sizes and hashes. Do not use partial output.

To run the included verification:

```sh
python3 -B -m unittest discover -s . -p 'test_*.py' -v
```

## Licence and provenance

The code and guide are offered under the included MIT licence, which permits
modification and redistribution, including commercial use. There is no exclusive
licence or restriction preventing others from sharing the code. The download
contains the runnable script, guide, synthetic examples and tests.

This release was produced with AI coding assistance and checked by automated CLI
tests and an example run. No customer adoption, independently audited security,
data-cleaning accuracy beyond its declared comparison rules, or earnings are
claimed. Keep originals and check the review file before making business changes.
