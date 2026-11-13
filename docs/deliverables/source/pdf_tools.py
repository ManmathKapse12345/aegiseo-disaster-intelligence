"""Helpers for build_pdfs.cjs (run with a Python that has PyMuPDF and pypdf).

    python pdf_tools.py pages body.pdf                 -> JSON {"H012": 7, ...}: page of each hidden heading marker
    python pdf_tools.py merge cover.pdf body.pdf out.pdf "Title" "Subject" outline.json
"""

from __future__ import annotations

import json
import re
import sys


def pages(pdf: str) -> None:
    import pymupdf as fitz

    found: dict[str, int] = {}
    with fitz.open(pdf) as doc:
        for i, page in enumerate(doc):
            for m in re.findall(r"@@(H\d+)@@", page.get_text()):
                found.setdefault(m, i + 1)
    print(json.dumps(found))


def merge(cover: str, body: str, out: str, title: str, subject: str, outline: str) -> None:
    from pypdf import PdfReader, PdfWriter

    w = PdfWriter()
    cover_reader = PdfReader(cover)
    if len(cover_reader.pages) != 1:
        raise SystemExit(f"the cover must be exactly one page, got {len(cover_reader.pages)}")
    w.append(cover_reader, import_outline=False)
    w.append(PdfReader(body), import_outline=False)
    n_body = len(w.pages) - 1
    # bookmarks from the document's own headings: [[level, title, body page (1-based)], ...]; body page p is writer page p
    parent = None
    with open(outline, encoding="utf-8") as f:
        for level, text, page in json.load(f):
            if not 1 <= page <= n_body:
                raise SystemExit(f"bookmark {text!r} points to page {page} of {n_body}")
            item = w.add_outline_item(text, page, parent=None if level == 1 else parent)
            if level == 1:
                parent = item
    # page labels: the cover is "Cover", the body counts 1, 2, 3 ... exactly like the printed footers and the contents
    w.set_page_label(0, 0, prefix="Cover")
    w.set_page_label(1, n_body, style="/D", start=1)
    w.add_metadata({"/Title": title, "/Subject": subject, "/Author": "AegisEO project", "/Creator": "AegisEO docs build (Chromium + pypdf)"})
    w.page_mode = "/UseOutlines"
    with open(out, "wb") as f:
        w.write(f)
    print(f"wrote {out}: {len(w.pages)} pages")


if __name__ == "__main__":
    if sys.argv[1] == "pages":
        pages(sys.argv[2])
    elif sys.argv[1] == "merge":
        merge(*sys.argv[2:8])
    else:
        raise SystemExit(__doc__)
