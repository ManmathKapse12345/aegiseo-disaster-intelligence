# Sources of the AegisEO deliverables

This folder builds the three files in `docs/deliverables/`:

| Output | Built from | Command |
|---|---|---|
| `AegisEO_Project_Documentation.pdf` | `doc/*.html` (one file per chapter; `00-cover.html` is the cover) | `node build_pdfs.cjs documentation` |
| `AegisEO_Viva_Questions_and_Answers.pdf` | `viva/*.html` | `node build_pdfs.cjs viva` |
| `AegisEO_Presentation.pptx` | `build_pptx.cjs` (slides and speaker notes are in the script) | `node build_pptx.cjs` |

## Requirements

- Node.js 20 or newer; run `npm install` here once (pptxgenjs).
- The frontend's Playwright installation (`frontend/node_modules`, with its Chromium), used to print the PDFs and render the diagrams.
- A Python with PyMuPDF and pypdf for page numbers, bookmarks and merging (`PYTHON` environment variable; default `C:/Python314/python.exe`).

## Order

```bash
npm install
node render_diagrams.cjs      # diagrams.js -> build/diagrams/*.png (used by the presentation)
node build_pdfs.cjs           # both PDFs; the HTML pages draw the same diagrams live
node build_pptx.cjs           # the presentation
```

`build/` is generated and not committed. The screenshots in `../screenshots/` are genuine captures of the running application (1440 × 900 window at 1.5× scale; phone shots with Playwright's Pixel 7 profile at 2× scale); they are inputs, not generated here.

## Conventions

- Every number must come from the code, the model files (`models/evaluation.json`, `models/benchmark.json`), the database of completed checks, or a test run; say which.
- Explain a technical term where it first appears (`<dfn>`); no glossary list, no metaphors.
- Keep existing features and future work apart; never describe practice (simulated) data as real.
- No keys, tokens or personal data in text or screenshots.

## Course submission (DiP, 12 Nov 2026)

1. Put the name, roll number, department and college in `paper/authors.json` (`fileprefix` becomes the start of every file name, e.g. `Manmath_Kapse_23CSD045`).
2. `node build_paper.cjs` builds the four-page IEEE paper (`paper/paper.html`) into `../submission/<prefix>_IEEE_Paper.pdf` and prints the page count (must be 4).
3. `python prepare_submission.py` (needs PyMuPDF) fills `../submission/form_uploads/` with the 10 supporting files (each under 10 MB; the documentation is recompressed) and `../submission/<prefix>/` with everything for the Google Drive folder, including the source code.
