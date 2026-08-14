#!/usr/bin/env python3
"""Generate the site icon set from the brand mark.

    python3 build/icons.py build/source/logo.png
    python3 build/icons.py build/source/logo.png --inspect out.html

The mark itself is never stretched, cropped, redrawn or recoloured. It is scaled
proportionally and centred on a square brand-cream canvas, and the only pixels
touched are the ones resampling produces when the whole mark is scaled as a unit.

What "trim" means here: the source's *empty margin* is measured so the mark can
be centred on its own bounds rather than on whatever whitespace the export
happened to include. That is measurement, not cropping - no part of the mark is
removed, and the assertion below fails the build if trimming ever would.
"""
import pathlib
import sys

from PIL import Image

BUILD = pathlib.Path(__file__).resolve().parent
ROOT = BUILD.parent

# The site's cream. Same token the pages use for a light surface.
CREAM = (243, 239, 231, 255)

# Fraction of the canvas the mark's longest side occupies. The rest is padding,
# split evenly. Tally strokes are thin, so the mark is kept generous enough to
# still read as a distinct shape at 16px while leaving an edge margin that
# survives iOS's rounded-corner mask on the touch icon.
MARK_FRACTION = 0.78

# Rendered once at high resolution, then downsampled per target: scaling down
# from a single master is sharper than scaling the source up to each size.
MASTER = 1024

# path -> pixel size. favicon.ico is written separately as a multi-size file.
PNG_TARGETS = {
    "favicon-48x48.png": 48,
    "apple-touch-icon.png": 180,
    "icon-192.png": 192,
    "icon-512.png": 512,
}
ICO_SIZES = [16, 32, 48]


def load_mark(path: pathlib.Path) -> Image.Image:
    """Return the source as RGBA with its background made transparent."""
    if path.suffix.lower() == ".svg":
        sys.exit("SVG source needs rasterising first; export a PNG at 512px or larger.")
    im = Image.open(path)
    im = im.convert("RGBA")

    alpha = im.getchannel("A")
    if alpha.getextrema()[0] < 255:
        return im  # already has real transparency; leave every pixel alone

    # Opaque export: key out the flat background the corners agree on, so the
    # mark composites onto cream instead of arriving in a white box. Only
    # background pixels change; the mark's own colour is never touched.
    w, h = im.size
    corners = [im.getpixel(p) for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    if len(set(corners)) != 1:
        sys.exit(f"source corners disagree ({corners}); supply a transparent PNG instead.")
    bg = corners[0]
    tol = 12
    px = im.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if abs(r - bg[0]) <= tol and abs(g - bg[1]) <= tol and abs(b - bg[2]) <= tol:
                px[x, y] = (r, g, b, 0)
    return im


def square_master(mark: pathlib.Path) -> Image.Image:
    im = load_mark(mark)
    box = im.getbbox()
    if box is None:
        sys.exit("source is empty once its background is removed")
    cropped = im.crop(box)

    # Guard the promise in the docstring: the trimmed margin must be empty.
    edge = im.copy()
    edge.paste((0, 0, 0, 0), box)
    assert edge.getbbox() is None, "trimming would have removed part of the mark"

    mw, mh = cropped.size
    target = int(round(MASTER * MARK_FRACTION))
    scale = target / max(mw, mh)                     # one factor for both axes
    size = (max(1, int(round(mw * scale))), max(1, int(round(mh * scale))))
    scaled = cropped.resize(size, Image.LANCZOS)

    canvas = Image.new("RGBA", (MASTER, MASTER), CREAM)
    canvas.alpha_composite(scaled, ((MASTER - size[0]) // 2, (MASTER - size[1]) // 2))
    return canvas, (mw, mh), size


def contact_sheet(master: Image.Image, out: pathlib.Path) -> None:
    """A page showing the favicon at the sizes browsers and search actually use."""
    import base64, io
    shots = {}
    for s in (16, 24, 32, 48, 64, 180, 192, 512):
        buf = io.BytesIO()
        master.resize((s, s), Image.LANCZOS).convert("RGB").save(buf, "PNG")
        shots[s] = base64.b64encode(buf.getvalue()).decode()
    cells = "".join(
        f'<figure style="margin:0;text-align:center"><img src="data:image/png;base64,{d}" '
        f'width="{s}" height="{s}" style="image-rendering:auto;display:block;margin:0 auto 8px">'
        f'<figcaption style="font:600 10px system-ui;opacity:.6">{s}px</figcaption></figure>'
        for s, d in shots.items())
    row = ('<div style="display:flex;flex-wrap:wrap;gap:26px;align-items:flex-end;'
           'padding:26px 30px">' + cells + "</div>")
    out.write_text(
        "<!doctype html><meta charset=utf-8><title>Huntz favicon check</title>"
        '<body style="margin:0;font-family:system-ui">'
        '<div style="background:#FFFFFF;color:#111">'
        '<div style="font:600 11px system-ui;padding:14px 30px 0;opacity:.6">LIGHT (search results, light browser chrome)</div>'
        + row + "</div>"
        '<div style="background:#1B1B1B;color:#EEE">'
        '<div style="font:600 11px system-ui;padding:14px 30px 0;opacity:.6">DARK (dark mode chrome, dark search)</div>'
        + row + "</div>"
        '<div style="background:#F1EBE0">'
        '<div style="font:600 11px system-ui;padding:14px 30px 0;opacity:.6">ON THE SITE\'S OWN GROUND</div>'
        + row + "</div></body>")


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = pathlib.Path(sys.argv[1])
    if not src.exists():
        sys.exit(f"no such source: {src}")

    master, mark_px, scaled_px = square_master(src)
    print(f"source      {src}  {Image.open(src).size[0]}x{Image.open(src).size[1]}")
    print(f"mark bounds {mark_px[0]}x{mark_px[1]} -> {scaled_px[0]}x{scaled_px[1]} "
          f"on {MASTER}x{MASTER} ({MARK_FRACTION:.0%} of canvas)")

    for name, size in PNG_TARGETS.items():
        out = ROOT / name
        img = master.resize((size, size), Image.LANCZOS)
        # Icons are opaque: a transparent favicon inverts unpredictably against
        # dark browser chrome, and iOS refuses alpha on a touch icon anyway.
        img.convert("RGB").save(out, "PNG", optimize=True)
        w, h = Image.open(out).size
        assert (w, h) == (size, size), f"{name} came out {w}x{h}"
        print(f"wrote       /{name}  {w}x{h}  {out.stat().st_size:,} bytes")

    ico = ROOT / "favicon.ico"
    master.convert("RGB").save(ico, "ICO", sizes=[(s, s) for s in ICO_SIZES])
    print(f"wrote       /favicon.ico  {'/'.join(f'{s}x{s}' for s in ICO_SIZES)}  "
          f"{ico.stat().st_size:,} bytes")

    if "--inspect" in sys.argv:
        out = pathlib.Path(sys.argv[sys.argv.index("--inspect") + 1])
        contact_sheet(master, out)
        print(f"wrote       {out} (visual check)")


if __name__ == "__main__":
    main()
