"""Build the iPhone trio per theme and copy final, theme-suffixed assets into
the web public marketing dir. The suffix is the UI theme and it matches the
page: `-light` shows on light pages, `-dark` on dark pages (the dark variants
carry a faint rim-light so they keep a silhouette there)."""
import glob, os, shutil
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
# ../../public/marketing (this tool lives in the web package it feeds).
DEST = os.path.join(HERE, "..", "..", "public", "marketing")
os.makedirs(DEST, exist_ok=True)


def trio(scheme):
    names = ["mobile-welcome", "mobile-editor", "mobile-terminal"]
    phones = [Image.open(f"{OUT}/{scheme}/{n}.png").convert("RGBA") for n in names]
    pw, ph = phones[0].size
    step = pw - int(pw * 0.16)
    W = step * (len(phones) - 1) + pw
    canvas = Image.new("RGBA", (W, ph), (0, 0, 0, 0))
    xs = [0, step * 2, step]
    for i in (0, 2, 1):                      # center phone on top
        canvas.alpha_composite(phones[i], (xs[i], 0))
    fw = 2000
    canvas = canvas.resize((fw, round(ph * fw / W)), Image.LANCZOS)
    canvas.save(f"{OUT}/{scheme}/mobile-trio.png")
    return canvas.size


# remove previous un-suffixed assets
for f in glob.glob(f"{DEST}/composery-*.png"):
    os.remove(f)

FINAL = {
    "editor-terminal": "composery-ide",
    "welcome": "composery-welcome",
    "editor": "composery-editor",
    "mobile-trio": "composery-mobile",
}
for scheme in ("dark", "light"):
    print("trio", scheme, trio(scheme))
    for src, base in FINAL.items():
        dst = f"{DEST}/{base}-{scheme}.png"
        shutil.copyfile(f"{OUT}/{scheme}/{src}.png", dst)
        print("->", os.path.basename(dst), os.path.getsize(dst) // 1024, "KB")
print("done")
