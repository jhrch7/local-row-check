#!/usr/bin/env python3
"""Compare browser reports with the existing Python engine on meaningful boundaries.

The explicit --work-dir must be new. Nothing is removed by this script.
"""
from pathlib import Path
import argparse
import base64
import csv
import importlib.util
import io
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def csv_bytes(rows):
    stream = io.StringIO(newline="")
    csv.writer(stream, lineterminator="\n").writerows(rows)
    return stream.getvalue().encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work-dir", type=Path, required=True)
    args = parser.parse_args()
    args.work_dir.mkdir(parents=False, exist_ok=False)
    spec = importlib.util.spec_from_file_location("rowcheck_oracle", ROOT / "rowcheck.py")
    oracle = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oracle)
    cases = [
        ("catalog", (ROOT / "examples/catalog/left.csv").read_bytes(), (ROOT / "examples/catalog/right.csv").read_bytes(), "SKU", ["Price", "Stock"], ","),
        ("quoted-multiline", b'ID,V\r\n1,"a,b\r\nc"\r\n2,a"b\r\n', b'ID,V\r\n1,"a,b\nc"\r\n3,""\r\n', "ID", ["V"], ","),
        ("duplicates-and-blank", b'ID,V\na,1\na,2\nb,3\n,4\n', b'ID,V\na,9\nb,03\n', "ID", ["V"], ","),
        ("unicode-order-and-space", 'ID,V\n\ue000,1\n😀,2\n\u0085,3\n\ufeff,4\n a,5\nA,6\n'.encode(), 'ID,V\n😀,3\n\ue000,1\na,5\nA,7\n'.encode(), "ID", ["V"], ","),
        ("metadata-numeric-prototype-headers", b'ID,__source_record__,__comparison_key__,10,2,__proto__,constructor\na,x,y,q,r,p,c\na,1,2,3,4,5,6\nz,g,h,i,j,k,l\n', b'ID,__source_record__,__comparison_key__,10,2,__proto__,constructor\nz,g,h,i,j,k,m\n', "ID", ["constructor"], ","),
        ("formula-prefixes", b'ID,V\n=x,=1+1\nz,+2\n', b'ID,V\n=x,-3\na,@x\n', "ID", ["V"], ","),
        ("semicolon-bom", '\ufeffID;V\r\na;"x;y"\r\nb;z\r\n'.encode(), b'ID;V\na;z\nc;y\n', "ID", ["V"], ";"),
        ("tab-key-only", b'ID\tV\na\tx\nb\ty\n', b'ID\tV\na\tz\n', "ID", [], "\t"),
        ("empty-data", b'ID,V\n', b'ID,V\n', "ID", ["V"], ","),
        ("compound-warehouse", (ROOT / "examples/warehouse/left.csv").read_bytes(), (ROOT / "examples/warehouse/right.csv").read_bytes(), ["SKU", "Warehouse"], ["Price", "Stock"], ","),
        ("compound-escaped-component-order",
         csv_bytes([["ID", "Region, label", "V"], ['q"', 'line\nbreak', 'old'], ['a\t', 'x', 'old'], ['a\n', 'x', 'old'], ['\ue000', 'x', 'old'], ['😀', 'x', 'old'], ['=x', '\\', '=1+1']]),
         csv_bytes([["V", "Region, label", "ID"], ['new', '\\', '=x'], ['new', 'x', '😀'], ['new', 'x', '\ue000'], ['new', 'x', 'a\n'], ['new', 'x', 'a\t'], ['new', 'line\nbreak', 'q"']]),
         ["ID", "Region, label"], ["V"], ","),
        ("compound-only-blank-and-duplicate", 'ID,W,V\na,x,1\na,x,2\na,y,3\n,北,4\n\u0085,z,5\nx,,6\n'.encode(), b'ID,W,V\na,x,9\nb,z,1\n', ["ID", "W"], [], ","),
        ("compound-header-only", b'ID,W,V\n', b'V,W,ID\n', ["ID", "W"], ["V"], ","),
    ]
    expected = []
    payload = []
    for name, left, right, key, columns, delimiter in cases:
        work = args.work_dir / name
        work.mkdir()
        (work / "left.csv").write_bytes(left)
        (work / "right.csv").write_bytes(right)
        a = oracle.read_input(work / "left.csv", key, delimiter, "utf-8-sig")
        b = oracle.read_input(work / "right.csv", key, delimiter, "utf-8-sig")
        result = oracle.compare(a, b, key, "none")
        changes = oracle.compare_values(a, b, result[2], columns)
        manifest = oracle.export(a, b, key, "none", delimiter, "utf-8-sig", work / "python-report", *result, columns=columns, changes=changes)
        expected.append((name, work, manifest))
        payload.append({"name": name, "left": base64.b64encode(left).decode(), "right": base64.b64encode(right).decode(), "key": key, "columns": columns, "delimiter": delimiter})
    runner = r'''
const fs = require('node:fs');
const R = require(process.argv[1]);
(async () => {
  const cases = JSON.parse(fs.readFileSync(0, 'utf8')), results = [];
  for (const c of cases) {
    const left = await R.readBytes(Buffer.from(c.left, 'base64'), 'left.csv', c.delimiter);
    const right = await R.readBytes(Buffer.from(c.right, 'base64'), 'right.csv', c.delimiter);
    const report = await R.makeReport(left, right, c.key, c.columns, c.delimiter);
    results.push({name: c.name, ...report, zip: Buffer.from(R.zip(report.files)).toString('base64')});
  }
  process.stdout.write(JSON.stringify(results));
})().catch(e => {console.error(e);process.exitCode = 1;});
'''
    p = subprocess.run(["node", "-e", runner, str(ROOT / "browser/core.js")], input=json.dumps(payload), capture_output=True, text=True, check=True)
    actual = json.loads(p.stdout)
    summary = []
    for (name, work, want), got in zip(expected, actual, strict=True):
        assert got["name"] == name
        for filename, metadata in want["outputs"].items():
            assert got["files"][filename].encode() == (work / "python-report" / filename).read_bytes(), (name, filename)
            assert got["manifest"]["outputs"][filename] == metadata, (name, filename, "hash")
        for field in ("key", "key_columns", "comparison_key_encoding", "sources", "counts", "formula_like_csv_cells_prefixed_with_apostrophe", "metadata_columns", "value_comparison"):
            assert got["manifest"].get(field) == want.get(field), (name, field)
        raw_zip = base64.b64decode(got["zip"])
        with zipfile.ZipFile(io.BytesIO(raw_zip)) as archive:
            assert archive.testzip() is None
            assert set(archive.namelist()) == set(got["files"])
            for filename, text in got["files"].items():
                assert archive.read(filename) == text.encode(), (name, filename, "ZIP")
        (work / "browser-report.zip").write_bytes(raw_zip)
        summary.append({"case": name, "csvFilesMatchBytesAndHashes": len(want["outputs"]), "countsMatch": True, "zipCRCAndContentsMatch": True})
    (args.work_dir / "parity-results.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({"passed": len(summary), "cases": summary}, indent=2))


if __name__ == "__main__":
    main()
