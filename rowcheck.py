#!/usr/bin/env python3
"""Compare two local CSV exports without guessing identities or uploading data."""
import argparse
import csv
import hashlib
import io
import json
from collections import defaultdict
from pathlib import Path
import sys
import unicodedata

VERSION = "1.0.0"


def normalise(value, mode):
    if mode == "trim":
        return value.strip()
    if mode == "fold":
        return " ".join(unicodedata.normalize("NFKC", value).split()).casefold()
    return value


def read_input(path, key, delimiter, encoding):
    raw = path.read_bytes()
    rows = list(csv.reader(io.StringIO(raw.decode(encoding), newline=""),
                           delimiter=delimiter, strict=True))
    if not rows:
        raise ValueError(f"{path.name}: empty file")
    header = rows[0]
    if not header or any(not h.strip() for h in header) or len(set(header)) != len(header):
        raise ValueError(f"{path.name}: headers must be nonempty and unique")
    if key not in header:
        raise ValueError(f"{path.name}: key column {key!r} is missing")
    if any("\x00" in cell for row in rows for cell in row):
        raise ValueError(f"{path.name}: NUL characters are unsupported")
    records = []
    for number, row in enumerate(rows[1:], 1):
        if len(row) != len(header):
            raise ValueError(f"{path.name}: data record {number} has {len(row)} fields; expected {len(header)}")
        records.append((number, dict(zip(header, row))))
    return {"name": path.name, "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw), "columns": header, "records": records}


def compare(left, right, key, mode):
    groups = {"left": defaultdict(list), "right": defaultdict(list)}
    review, only, shared = [], {"left": [], "right": []}, []
    for side, data in (("left", left), ("right", right)):
        for number, row in data["records"]:
            value = normalise(row[key], mode)
            if not value.strip():
                review.append((side, number, "blank key", value, row))
            else:
                groups[side][value].append((number, row))
    # Sort by key for repeatable output. Source record numbers keep source order recoverable.
    for value in sorted(set(groups["left"]) | set(groups["right"])):
        a, b = groups["left"][value], groups["right"][value]
        if len(a) > 1 or len(b) > 1:
            for side, records in (("left", a), ("right", b)):
                review.extend((side, number, "duplicate comparison key", value, row)
                              for number, row in records)
        elif a and b:
            shared.append((value, a[0][0], b[0][0], a[0][1][key], b[0][1][key]))
        else:
            side = "left" if a else "right"
            number, row = (a or b)[0]
            only[side].append((number, value, row))
    for side, data in (("left", left), ("right", right)):
        assert len(data["records"]) == len(only[side]) + len(shared) + sum(r[0] == side for r in review)
    return only, review, shared


def export(left, right, key, mode, delimiter, encoding, output, only, review, shared):
    escaped = 0

    def safe(value):
        nonlocal escaped
        value = str(value)
        if value.startswith(("\t", "\r", "\n")) or value.lstrip().startswith(("=", "+", "-", "@")):
            escaped += 1
            return "'" + value
        return value

    # Build every CSV before creating the output directory. No output directory is overwritten.
    files = {}

    def make_csv(name, rows):
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer, lineterminator="\n")
        for row in rows:
            writer.writerow([safe(cell) for cell in row])
        files[name] = buffer.getvalue().encode("utf-8-sig")

    metadata = {}
    for side, data in (("left", left), ("right", right)):
        record_col, key_col = "__source_record__", "__comparison_key__"
        while record_col in data["columns"]:
            record_col += "_"
        while key_col in data["columns"] or key_col == record_col:
            key_col += "_"
        metadata[side] = [record_col, key_col]
        make_csv(f"only_{side}.csv", [[record_col, key_col] + data["columns"]] +
                 [[n, value] + [row[c] for c in data["columns"]] for n, value, row in only[side]])
    make_csv("review.csv", [["source", "source_record", "reason", "comparison_key", "original_row_json"]] +
             [[side, n, reason, value, json.dumps(row, ensure_ascii=False)]
              for side, n, reason, value, row in review])
    make_csv("shared_keys.csv", [["comparison_key", "left_source_record", "right_source_record", "left_original_key", "right_original_key"]] + list(shared))
    manifest = {
        "version": VERSION, "key": key, "normalisation": mode,
        "input_delimiter": delimiter, "input_encoding": encoding,
        "source_record_definition": "1-based CSV data record, excluding the header; not a physical line number",
        "sources": {side: {k: data[k] for k in ("name", "sha256", "bytes", "columns")}
                    for side, data in (("left", left), ("right", right))},
        "counts": {side: {"input": len(data["records"]), "only": len(only[side]),
                          "shared": len(shared), "review": sum(r[0] == side for r in review)}
                   for side, data in (("left", left), ("right", right))},
        "formula_like_csv_cells_prefixed_with_apostrophe": escaped,
        "metadata_columns": metadata,
        "outputs": {name: {"sha256": hashlib.sha256(content).hexdigest(), "bytes": len(content)}
                    for name, content in files.items()},
        "limits": ["Shared keys do not prove two rows refer to the same person.",
                   "No fuzzy matching, enrichment or correction is performed.",
                   "Original input files are the authoritative source of original cell values.",
                   "Reports contain your data; keep them private."]
    }
    files["manifest.json"] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode()
    output.mkdir(exist_ok=False)
    # A disk/write failure may leave a partial directory. An incomplete directory has no manifest.
    for name, content in files.items():
        with (output / name).open("xb") as target:
            target.write(content)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("left", type=Path)
    parser.add_argument("right", type=Path)
    parser.add_argument("--key", required=True, help="Exact column header present in both files")
    parser.add_argument("--out", required=True, type=Path, help="New report directory; must not exist")
    parser.add_argument("--normalise", choices=("none", "trim", "fold"), default="none")
    parser.add_argument("--delimiter", choices=(",", ";", "\t"), default=",")
    parser.add_argument("--encoding", default="utf-8-sig", help="Input encoding; output is UTF-8 with BOM")
    args = parser.parse_args(argv)
    try:
        csv.field_size_limit(10 * 1024 * 1024)
        left = read_input(args.left, args.key, args.delimiter, args.encoding)
        right = read_input(args.right, args.key, args.delimiter, args.encoding)
        result = compare(left, right, args.key, args.normalise)
        manifest = export(left, right, args.key, args.normalise, args.delimiter,
                          args.encoding, args.out, *result)
    except (OSError, ValueError, UnicodeError, LookupError, csv.Error) as error:
        print(f"Error: {error}", file=sys.stderr)
        return 2
    print(json.dumps({"report": str(args.out), "counts": manifest["counts"]}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
