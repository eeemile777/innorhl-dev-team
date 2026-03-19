#!/usr/bin/env python3
"""
scrape_to_md.py
Walks the project directory and dumps every file's content into one big Markdown file.
Usage: python scrape_to_md.py [output_file]
"""

import os
import sys
from pathlib import Path
from datetime import datetime

# ── Config ─────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).parent          # run from GOD_template/
OUTPUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "FULL_DUMP.md"

# Skip these — they're noise or binaries
SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv",
    "dist", "build", ".next", ".turbo", "coverage",
    "eval-viewer",        # Playwright test-runner UI (binary assets)
}

SKIP_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
    ".woff", ".woff2", ".ttf", ".eot",
    ".zip", ".tar", ".gz", ".lock",
    ".pyc", ".class", ".exe", ".bin",
}

# Don't dump the output file into itself
SKIP_FILES = {OUTPUT.name, "scrape_to_md.py"}

# Max bytes per file before we truncate (5 KB)
MAX_BYTES = 5_000

# ── Helpers ────────────────────────────────────────────────────────────────────
def lang_hint(path: Path) -> str:
    """Return a fenced-code language hint from the file extension."""
    return {
        ".md": "markdown", ".json": "json", ".yaml": "yaml", ".yml": "yaml",
        ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
        ".py": "python", ".sh": "bash", ".env": "bash",
        ".toml": "toml", ".css": "css", ".html": "html",
    }.get(path.suffix.lower(), "")


def collect_files(root: Path):
    """Yield all files, breadth-first, respecting skip lists."""
    for dirpath, dirnames, filenames in os.walk(root):
        # Prune skipped directories in-place
        dirnames[:] = sorted(
            d for d in dirnames
            if d not in SKIP_DIRS and not d.startswith(".")
        )
        for name in sorted(filenames):
            if name in SKIP_FILES:
                continue
            p = Path(dirpath) / name
            if p.suffix.lower() in SKIP_EXTENSIONS:
                continue
            yield p


# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    files = list(collect_files(ROOT))
    print(f"Found {len(files)} files. Writing to {OUTPUT} ...")

    with OUTPUT.open("w", encoding="utf-8") as out:
        out.write(f"# Full Project Dump\n")
        out.write(f"**Generated**: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  \n")
        out.write(f"**Root**: `{ROOT}`  \n")
        out.write(f"**Files**: {len(files)}\n\n")
        out.write("---\n\n")

        # Table of contents
        out.write("## Table of Contents\n\n")
        for f in files:
            rel = f.relative_to(ROOT)
            anchor = str(rel).replace("/", "").replace(".", "").replace("_", "").replace("-", "").lower()
            out.write(f"- [{rel}](#{anchor})\n")
        out.write("\n---\n\n")

        # File contents
        for f in files:
            rel = f.relative_to(ROOT)
            anchor = str(rel).replace("/", "").replace(".", "").replace("_", "").replace("-", "").lower()
            out.write(f"## {rel}\n\n")

            try:
                raw = f.read_bytes()
                # Try UTF-8; fall back to latin-1 to avoid crashing on weird chars
                try:
                    text = raw.decode("utf-8")
                except UnicodeDecodeError:
                    text = raw.decode("latin-1")

                truncated = False
                if len(raw) > MAX_BYTES:
                    text = text[:MAX_BYTES]
                    truncated = True

                hint = lang_hint(f)
                out.write(f"```{hint}\n")
                out.write(text)
                if not text.endswith("\n"):
                    out.write("\n")
                out.write("```\n")
                if truncated:
                    out.write(f"\n> _(truncated — file is {len(raw):,} bytes, showing first {MAX_BYTES:,})_\n")

            except Exception as e:
                out.write(f"> **Error reading file**: {e}\n")

            out.write("\n---\n\n")

    size_kb = OUTPUT.stat().st_size / 1024
    print(f"Done. {OUTPUT.name} is {size_kb:.1f} KB")


if __name__ == "__main__":
    main()
