"""Assembles one member's DiP submission (run make_submission.sh to build everything from a clean slate).

    PREFIX=Name_RollNumber python prepare_submission.py
    (after: node build_paper.cjs and node build_components.cjs with the same PREFIX)

Output in docs/deliverables/submission/<prefix>/:
  1_Form_IEEE_Paper/            the 4-page IEEE paper -> form field "Four-page IEEE Conference Paper"
  2_Form_Supporting_Files/      exactly 10 files (8 components + report + PPT), each <= 10 MB -> form field "Supporting Project Files"
  3_Google_Drive_Folder/<prefix>/   the organised project folder (all components, source code) -> upload to Drive, share the link
"""
import json
import os
import shutil
import subprocess
from pathlib import Path

import pymupdf

SRC = Path(__file__).resolve().parent
DELIV = SRC.parent
REPO = DELIV.parent.parent
OUT = DELIV / "submission"
LIMIT = 10 * 1024 * 1024

cfg = json.loads((SRC / "paper" / "authors.json").read_text(encoding="utf-8"))
P = os.environ.get("PREFIX") or cfg["fileprefix"]
paper = OUT / f"{P}_IEEE_Paper.pdf"
comps = OUT / f"{P}_components"
for need in (paper, comps):
    if not need.exists():
        raise SystemExit(f"missing {need}; run build_paper.cjs and build_components.cjs first")

root = OUT / P
if root.exists():
    shutil.rmtree(root)
form_paper = root / "1_Form_IEEE_Paper"
form_files = root / "2_Form_Supporting_Files"
drive = root / "3_Google_Drive_Folder" / P
for d in (form_paper, form_files, drive):
    d.mkdir(parents=True)


def comp(n: str) -> Path:
    return next(comps.glob(f"{P}_{n}_*.pdf"))


# Shared, prefix-independent intermediate: the recompressed project report (built once).
report_small = OUT / "_Project_Report_compressed.pdf"
if not report_small.exists():
    doc = pymupdf.open(DELIV / "AegisEO_Project_Report.pdf")
    doc.rewrite_images(dpi_threshold=150, dpi_target=130, quality=72, lossy=True, lossless=True, bitonal=False, color=True, gray=True)
    doc.save(report_small, garbage=4, deflate=True, clean=True)

# 1. Form: IEEE paper.
shutil.copy2(paper, form_paper / paper.name)

# 2. Form: 10 supporting files.
for f in sorted(comps.glob("*.pdf")):
    shutil.copy2(f, form_files / f.name)
shutil.copy2(report_small, form_files / f"{P}_09_Full_Project_Report.pdf")
shutil.copy2(DELIV / "AegisEO_Presentation.pptx", form_files / f"{P}_10_Presentation.pptx")
uploads = sorted(form_files.iterdir())
assert len(uploads) == 10, [u.name for u in uploads]
for u in uploads:
    assert u.stat().st_size <= LIMIT, f"{u.name} is over 10 MB"
    assert u.name.startswith(P + "_")

# 3. Google Drive folder, organised by the eight required components.
diag = SRC / "build" / "diagrams"
layout = {
    "00_IEEE_Paper": [(paper, paper.name)],
    "01_Problem_Statement": [(comp("01"), None)],
    "02_State_of_the_Art": [(comp("02"), None)],
    "03_Methodology_Flowchart_Pseudocode": [(comp("03"), None), (diag / "pipeline.png", f"{P}_Flowchart.png"),
                                            (diag / "fusion.png", f"{P}_Fusion_Model_Diagram.png")],
    "04_Implementation_Source_Code": [(comp("04"), None), (diag / "architecture.png", f"{P}_System_Architecture.png")],
    "05_Dataset_and_Data_Sources": [(comp("05"), None)],
    "06_Novelty_USP_Digital_Image_Processing": [(comp("06"), None)],
    "07_Results_and_Dashboards": [(comp("07"), None)],
    "08_References": [(comp("08"), None)],
    "09_Project_Report_and_Presentation": [(report_small, f"{P}_Full_Project_Report.pdf"),
                                           (DELIV / "AegisEO_Presentation.pptx", f"{P}_Presentation.pptx")],
}
for folder, items in layout.items():
    d = drive / folder
    d.mkdir()
    for src, name in items:
        shutil.copy2(src, d / (name or src.name))

shots = drive / "07_Results_and_Dashboards" / f"{P}_Screenshots"
shots.mkdir()
for s in sorted((DELIV / "screenshots").glob("*.jpg")):
    shutil.copy2(s, shots / f"{P}_{s.name}")

# Source code: original files with their original names (renaming would break imports), inside a prefixed folder.
code = drive / "04_Implementation_Source_Code" / f"{P}_Source_Code"
listed = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                        cwd=REPO, capture_output=True, text=True, check=True).stdout.splitlines()
n = 0
for rel in listed:
    if rel.startswith("docs/deliverables/") or Path(rel).name in {".env", "tsconfig.tsbuildinfo"}:
        continue
    s = REPO / rel
    if s.is_file():
        t = code / rel
        t.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(s, t)
        n += 1

print(f"[{P}] form paper: {paper.name} ({paper.stat().st_size / 1048576:.2f} MB)")
for u in uploads:
    print(f"  {u.stat().st_size / 1048576:5.2f} MB  {u.name}")
print(f"  drive folder: {sum(1 for _ in drive.rglob('*') if _.is_file())} files ({n} source files)")
