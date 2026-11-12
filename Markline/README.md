# Markline

PDF markup and quantity takeoff for construction drawings, for macOS 12 or later.

Markline is an original app. It is not affiliated with, and does not copy the
branding or artwork of, any other PDF product. It reads and writes standard PDF
annotations, so files move cleanly between Markline and other PDF tools.

## Get the app

**DMG (no Xcode needed).** Every push builds a universal (Apple silicon + Intel)
DMG on GitHub: open the repository's **Actions** tab, pick the latest
"Build Markline for macOS" run, and download the **Markline-dmg** artifact.
Open the DMG and drag Markline to Applications. The build is not notarized by
Apple, so the first time you must right-click the app and choose **Open**
(or allow it under System Settings > Privacy & Security).

**Xcode.** Open `Markline.xcodeproj` and press Run. No packages or setup steps.

## What it does

- Opens multi-page PDFs in tabs, with page thumbnails, sharp zoom to 6400 %, and text search.
- Markup tools: text box, callout, line, arrow, rectangle, ellipse, polygon, cloud,
  polyline, pen, highlighter, highlight area.
- Measurement tools: calibrate, length, polylength, area, perimeter, volume, count.
  Scale presets (architectural, engineering, metric), custom scales, per-page scales.
- Markups list with sort, filter, grouping, live totals, and CSV export.
- Properties panel (colors, widths, fills, opacity, subject, label, comment) and a
  Tool Chest of saved tools.
- Select, move, reshape, add or remove vertices, copy/paste, duplicate, undo/redo, snap.
- Page tools: rotate, delete, insert pages from another PDF.
- Saves markups as real PDF annotations that display in any PDF viewer, and re-opens
  them fully editable. Markups made in other applications are imported for editing.

## Layout

- `Markline/web/`: the application itself (HTML/CSS/JavaScript; `pdf.js` renders, `pdf-lib` writes).
- `Markline/AppDelegate.swift`, `main.swift`: the native Mac window, menus, and file dialogs.
- `../.github/workflows/build-mac.yml`: builds the app and DMG.

Third-party libraries in `Markline/web/vendor` keep their own licenses (Apache-2.0 and MIT).
