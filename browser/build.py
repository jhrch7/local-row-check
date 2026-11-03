#!/usr/bin/env python3
"""Build the offline file from reviewed local sources, with no downloads."""
from pathlib import Path
import json

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def build():
    template = (HERE / "template.html").read_text()
    ui = (HERE / "ui.js").read_text()
    for side in ("left", "right"):
        value = (ROOT / "examples/catalog" / f"{side}.csv").read_text()
        # Escape HTML script terminators in any future synthetic example.
        value = json.dumps(value, ensure_ascii=False).replace("<", "\\u003c")
        ui = ui.replace(f"/* ROWCHECK_EXAMPLE_{side.upper()} */", value)
    for name, value in (("STYLE", (HERE / "style.css").read_text()),
                        ("CORE", (HERE / "core.js").read_text()), ("UI", ui)):
        marker = f"/* ROWCHECK_{name} */"
        assert template.count(marker) == 1
        template = template.replace(marker, value)
    assert "/* ROWCHECK_" not in template
    licence = (ROOT / "LICENSE").read_text()
    assert "-->" not in licence
    template += "\n<!--\n" + licence + "-->\n"
    output = ROOT / "rowcheck-offline.html"
    output.write_text(template)
    print(f"Built {output.name}: {output.stat().st_size} bytes")


if __name__ == "__main__":
    build()
