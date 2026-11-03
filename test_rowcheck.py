import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("rowcheck.py")


class RowCheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def write(self, name, rows, delimiter=","):
        path = self.root / name
        with path.open("w", newline="", encoding="utf-8-sig") as f:
            csv.writer(f, delimiter=delimiter).writerows(rows)
        return path

    def run_tool(self, left, right, *options):
        return self.run_keys(left, right, ["Name"], *options)

    def run_keys(self, left, right, keys, *options, report="reports"):
        output = self.root / report
        result = subprocess.run([sys.executable, str(SCRIPT), str(left), str(right),
                                 *[part for key in keys for part in ("--key", key)],
                                 "--out", str(output), *options],
                                capture_output=True, text=True)
        return result, output

    def read_csv(self, path):
        with path.open(encoding="utf-8-sig", newline="") as f:
            return list(csv.reader(f))

    def test_different_schemas_reconcile_and_inputs_unchanged(self):
        a = self.write("a.csv", [["Name", "Note"], ["Alex", "line one\nline two"], ["Sam", "a,b"]])
        b = self.write("b.csv", [["Name", "Email"], ["Alex", "x@example.test"], ["Lee", "y@example.test"]])
        before = [p.read_bytes() for p in (a, b)]
        result, out = self.run_tool(a, b)
        self.assertEqual(result.returncode, 0, result.stderr)
        m = json.loads((out / "manifest.json").read_text())
        self.assertNotIn("value_changes.csv", m["outputs"])
        self.assertNotIn("value_comparison", m)
        self.assertEqual(m["counts"], {"left": {"input": 2, "only": 1, "shared": 1, "review": 0},
                                       "right": {"input": 2, "only": 1, "shared": 1, "review": 0}})
        self.assertEqual(self.read_csv(out / "only_left.csv")[1][-2:], ["Sam", "a,b"])
        self.assertEqual(before, [p.read_bytes() for p in (a, b)])
        for name, info in m["outputs"].items():
            self.assertEqual(hashlib.sha256((out / name).read_bytes()).hexdigest(), info["sha256"])

    def test_fold_collisions_duplicates_and_blank_keys_require_review(self):
        a = self.write("a.csv", [["Name"], ["ＡLEX"], ["alex"], ["   "], ["  Sam  Smith "]])
        b = self.write("b.csv", [["Name"], ["Alex"], ["sam smith"], ["Lee"]])
        result, out = self.run_tool(a, b, "--normalise", "fold")
        self.assertEqual(result.returncode, 0, result.stderr)
        m = json.loads((out / "manifest.json").read_text())
        self.assertEqual(m["counts"]["left"], {"input": 4, "only": 0, "shared": 1, "review": 3})
        self.assertEqual(m["counts"]["right"], {"input": 3, "only": 1, "shared": 1, "review": 1})
        self.assertEqual(len(self.read_csv(out / "review.csv")), 5)

    def test_literal_is_default_and_trim_is_explicit(self):
        a = self.write("a.csv", [["Name"], ["Alex "]])
        b = self.write("b.csv", [["Name"], ["Alex"]])
        result, out = self.run_tool(a, b)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((out / "manifest.json").read_text())["counts"]["left"]["shared"], 0)
        result = subprocess.run([sys.executable, str(SCRIPT), str(a), str(b), "--key", "Name",
                                 "--out", str(self.root / "trimmed"), "--normalise", "trim"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.root / "trimmed" / "manifest.json").read_text())["counts"]["left"]["shared"], 1)

    def test_formula_cells_are_safe_and_originals_preserved(self):
        a = self.write("a.csv", [["Name", "Note"], ["=1+1", " @SUM(A1:A2)"], ["-2", "\ttext"]])
        b = self.write("b.csv", [["Name"], ["ordinary"]])
        original = a.read_bytes()
        result, out = self.run_tool(a, b)
        self.assertEqual(result.returncode, 0, result.stderr)
        rows = self.read_csv(out / "only_left.csv")
        self.assertTrue(all(not cell.lstrip().startswith(("=", "+", "-", "@", "\t")) for row in rows for cell in row))
        self.assertEqual(a.read_bytes(), original)
        self.assertGreater(json.loads((out / "manifest.json").read_text())["formula_like_csv_cells_prefixed_with_apostrophe"], 0)

    def test_malformed_inputs_fail_before_output(self):
        valid = self.write("valid.csv", [["Name"], ["Alex"]])
        for rows in ([["Name", "Name"], ["a", "b"]], [["Other"], ["a"]],
                     [["Name", "Note"], ["a"]], [["Name"], ["a\x00b"]]):
            with self.subTest(rows=rows):
                bad = self.write("bad.csv", rows)
                result, out = self.run_tool(bad, valid)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(out.exists())

    def test_existing_directory_is_never_overwritten(self):
        a = self.write("a.csv", [["Name"], ["Alex"]])
        b = self.write("b.csv", [["Name"], ["Alex"]])
        out = self.root / "reports"
        out.mkdir()
        sentinel = out / "keep.txt"
        sentinel.write_text("keep")
        result, _ = self.run_tool(a, b)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(list(out.iterdir()), [sentinel])
        self.assertEqual(sentinel.read_text(), "keep")

    def test_semicolon_empty_file_and_header_only(self):
        a = self.write("a.csv", [["Name", "Note"]], delimiter=";")
        b = self.write("b.csv", [["Name"], ["Élodie"]], delimiter=";")
        result, out = self.run_tool(a, b, "--delimiter", ";")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((out / "manifest.json").read_text())["counts"]["right"]["only"], 1)
        empty = self.root / "empty.csv"
        empty.write_bytes(b"")
        result = subprocess.run([sys.executable, str(SCRIPT), str(empty), str(b), "--key", "Name",
                                 "--out", str(self.root / "bad")], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertFalse((self.root / "bad").exists())

    def test_selected_values_use_exact_text_and_preserve_row_accounting(self):
        a = self.write("a.csv", [["Name", "Price", "Stock", "Title"],
                                 [" Sam ", "10.00", "4", "Widget"],
                                 ["Lee", "20.00", "3", "Cable"], ["No", "5", "1", "Old title"]])
        b = self.write("b.csv", [["Stock", "Name", "Price", "Title"],
                                 ["4", "Sam", "12.00", "Widget"],
                                 ["5", "Lee", "20.0", "Cable"], ["1", "No", "5", "New title"]])
        original = [p.read_bytes() for p in (a, b)]
        result, out = self.run_tool(a, b, "--normalise", "trim", "--compare-columns", "Price", "Stock")
        self.assertEqual(result.returncode, 0, result.stderr)
        m = json.loads((out / "manifest.json").read_text())
        self.assertEqual(self.read_csv(out / "value_changes.csv")[1:], [
            ["Lee", "2", "2", "Price", "20.00", "20.0"],
            ["Lee", "2", "2", "Stock", "3", "5"],
            ["Sam", "1", "1", "Price", "10.00", "12.00"],
        ])
        stats = m["value_comparison"]
        self.assertEqual([stats[k] for k in ("shared_keys_compared", "keys_with_changes",
                                            "keys_without_selected_changes", "changed_cells")], [3, 2, 1, 3])
        self.assertEqual(m["counts"]["left"], {"input": 3, "only": 0, "shared": 3, "review": 0})
        self.assertEqual(original, [p.read_bytes() for p in (a, b)])
        self.assertEqual(json.loads(result.stdout)["value_comparison"], stats)
        for name, info in m["outputs"].items():
            raw = (out / name).read_bytes()
            self.assertEqual(len(raw), info["bytes"])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), info["sha256"])

    def test_duplicate_and_blank_keys_are_not_paired_for_value_changes(self):
        a = self.write("a.csv", [["Name", "Note"], ["Dup", "a"], ["Dup", "b"],
                                 ["", "c"], ["Safe", "=1+1\nline two"]])
        b = self.write("b.csv", [["Name", "Note"], ["Dup", "z"], ["Safe", "\t@different"]])
        result, out = self.run_tool(a, b, "--compare-columns", "Note")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.read_csv(out / "value_changes.csv")[1:], [
            ["Safe", "4", "2", "Note", "'=1+1\nline two", "'\t@different"],
        ])
        m = json.loads((out / "manifest.json").read_text())
        self.assertEqual(m["counts"]["left"], {"input": 4, "only": 0, "shared": 1, "review": 3})
        self.assertEqual(m["counts"]["right"], {"input": 2, "only": 0, "shared": 1, "review": 1})
        self.assertEqual(m["value_comparison"]["changed_cells"], 1)

    def test_invalid_selected_columns_fail_before_output(self):
        a = self.write("a.csv", [["Name", "Price"], ["Sam", "10"]])
        b = self.write("b.csv", [["Name", "Stock"], ["Sam", "2"]])
        for columns in (["Price"], ["Stock"], ["Unknown"], ["Name"], ["Price", "Price"], []):
            with self.subTest(columns=columns):
                result, out = self.run_tool(a, b, "--compare-columns", *columns)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(out.exists())

    def test_header_only_value_comparison_produces_an_empty_valid_report(self):
        a = self.write("a.csv", [["Name", "Price"]])
        b = self.write("b.csv", [["Name", "Price"]])
        result, out = self.run_tool(a, b, "--compare-columns", "Price")
        self.assertEqual(result.returncode, 0, result.stderr)
        m = json.loads((out / "manifest.json").read_text())
        self.assertEqual(len(self.read_csv(out / "value_changes.csv")), 1)
        self.assertEqual(m["value_comparison"]["shared_keys_compared"], 0)
        self.assertEqual(m["value_comparison"]["changed_cells"], 0)

    def test_multi_column_example_preserves_rows_and_reports_three_changes(self):
        fixture = SCRIPT.parent / "examples" / "warehouse"
        result, out = self.run_keys(fixture / "left.csv", fixture / "right.csv", ["SKU", "Warehouse"],
                                    "--compare-columns", "Price", "Stock")
        self.assertEqual(result.returncode, 0, result.stderr)
        m = json.loads((out / "manifest.json").read_text())
        self.assertEqual(m["key"], ["SKU", "Warehouse"])
        self.assertEqual(m["key_columns"], ["SKU", "Warehouse"])
        self.assertEqual(m["counts"], {"left": {"input": 9, "only": 1, "shared": 5, "review": 3},
                                      "right": {"input": 8, "only": 1, "shared": 5, "review": 2}})
        changes = self.read_csv(out / "value_changes.csv")[1:]
        self.assertEqual([(json.loads(r[0]), r[3]) for r in changes],
                         [(["A", "B|C"], "Price"), (["A", "North"], "Stock"), (["A", "South"], "Price")])
        self.assertEqual(m["value_comparison"]["keys_with_changes"], 3)
        self.assertEqual(m["value_comparison"]["changed_cells"], 3)
        review = self.read_csv(out / "review.csv")[1:]
        self.assertEqual(sum(r[2] == "blank key" for r in review), 2)
        self.assertEqual(sum(r[2] == "duplicate comparison key" for r in review), 3)

    def test_compound_keys_are_structured_and_sorted_by_components(self):
        keys = [["A|B", "C"], ["A", "B|C"], ['q"', "line\nbreak"],
                ["a\t", "x"], ["a\n", "x"], ["\ue000", "x"], ["😀", "x"], ["=x", "z"]]
        a = self.write("a.csv", [["Name", "Region, label", "V"], *[k + ["before"] for k in keys]])
        b = self.write("b.csv", [["V", "Region, label", "Name"], *[["after", k[1], k[0]] for k in reversed(keys)]])
        result, out = self.run_keys(a, b, ["Name", "Region, label"], "--compare-columns", "V")
        self.assertEqual(result.returncode, 0, result.stderr)
        shared = self.read_csv(out / "shared_keys.csv")[1:]
        self.assertEqual([json.loads(r[0]) for r in shared], sorted(keys))
        self.assertEqual([json.loads(r[3]) for r in shared], sorted(keys))
        self.assertEqual([json.loads(r[4]) for r in shared], sorted(keys))
        self.assertEqual(len(self.read_csv(out / "value_changes.csv")) - 1, len(keys))

    def test_multi_key_normalisation_applies_to_each_component_only(self):
        for mode, before in (("trim", [" Sam ", " South "]), ("fold", ["Ｓam", " SOUTH "])):
            with self.subTest(mode=mode):
                a = self.write("a.csv", [["Name", "Warehouse", "V"], before + ["1 "]])
                b = self.write("b.csv", [["Name", "Warehouse", "V"], ["Sam", "South", "1"]])
                result, out = self.run_keys(a, b, ["Name", "Warehouse"], "--normalise", mode,
                                            "--compare-columns", "V", report=mode)
                self.assertEqual(result.returncode, 0, result.stderr)
                shared = self.read_csv(out / "shared_keys.csv")[1:]
                self.assertEqual(len(shared), 1)
                self.assertEqual(json.loads(shared[0][3]), before)
                self.assertEqual(json.loads(shared[0][4]), ["Sam", "South"])
                self.assertEqual(self.read_csv(out / "value_changes.csv")[1][-2:], ["1 ", "1"])

    def test_fold_component_collisions_and_blanks_withhold_both_sides(self):
        a = self.write("a.csv", [["Name", "Warehouse", "V"], ["Ａlex", "North", "1"],
                                 ["alex", "north", "2"], ["Blank", "\u0085", "3"], ["", "North", "4"]])
        b = self.write("b.csv", [["Name", "Warehouse", "V"], ["ALEX", "NORTH", "9"]])
        result, out = self.run_keys(a, b, ["Name", "Warehouse"], "--normalise", "fold", "--compare-columns", "V")
        self.assertEqual(result.returncode, 0, result.stderr)
        m = json.loads((out / "manifest.json").read_text())
        self.assertEqual(m["counts"]["left"], {"input": 4, "only": 0, "shared": 0, "review": 4})
        self.assertEqual(m["counts"]["right"], {"input": 1, "only": 0, "shared": 0, "review": 1})
        self.assertEqual(m["value_comparison"]["changed_cells"], 0)

    def test_invalid_multi_key_choices_fail_without_output(self):
        a = self.write("a.csv", [["Name", "Warehouse", "V"], ["a", "b", "1"]])
        b = self.write("b.csv", [["Name", "Warehouse", "V"], ["a", "b", "2"]])
        for keys, options in ((["Name", "Name"], []), (["Name", "Missing"], []),
                              (["Name", "Warehouse"], ["--compare-columns", "Warehouse"])):
            with self.subTest(keys=keys, options=options):
                result, out = self.run_keys(a, b, keys, *options)
                self.assertEqual(result.returncode, 2)
                self.assertFalse(out.exists())


if __name__ == "__main__":
    unittest.main()
