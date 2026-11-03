# Changes

## 1.3.0

- Compare on a combination of columns in the CLI and offline browser, such as
  SKU + Warehouse. Repeat `--key` in the CLI; use **Add key column** in the browser.
- Keep key components separate, with JSON-array keys in multi-column reports.
  Delimiters inside values cannot merge different combinations.
- Hold any blank component and every duplicated combination for review,
  including all corresponding rows in the other file. Single-column report
  formats remain compatible.
- Include a runnable warehouse example, generated reports and actual browser
  captures. The older catalogue example remains available.

Multi-column keys address a recurring public request, including csv-diff
[issue 1](https://github.com/simonw/csv-diff/issues/1) and
[issue 23](https://github.com/simonw/csv-diff/issues/23). Other tools and patches
already support the concept. This is an extension of Local Row Check, with its
existing review rules, local processing and declared resource limits.

## Earlier releases

- 1.2.0: single-file offline browser edition.
- 1.1.0: optional selected-value comparison in the Python CLI.
- 1.0.0: local key reconciliation and ambiguity reports.

Previous tags and release files remain available.
