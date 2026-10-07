"""Independent CI-only text QA; the ScribdDock runtime does not use Python."""

import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

from pypdf import PdfReader


def verify(path: str) -> None:
    fixture = json.loads(
        (Path(__file__).resolve().parents[1] / "tests/fixtures/public-five-page-text.json").read_text(encoding="utf-8")
    )
    expected = fixture["page_text_sha256"]
    document = PdfReader(path)
    if len(document.pages) != len(expected):
        raise ValueError(f"Expected {len(expected)} pages, got {len(document.pages)}")
    for number, (page, digest) in enumerate(zip(document.pages, expected), 1):
        text = page.extract_text()
        canonical = re.sub(r"\s+", "", unicodedata.normalize("NFKC", text))
        actual = hashlib.sha256(canonical.encode()).hexdigest()
        if actual != digest:
            raise ValueError(f"Page {number}: extracted text differs from Python reference")
    print(f"pypdf: all {len(expected)} pages match reference text after normalization")


if __name__ == "__main__":
    verify(sys.argv[1])
