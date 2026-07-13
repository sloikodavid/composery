"""Frame raw Composery captures into realistic macOS/iOS marketing PNGs.

Desktop -> a macOS Safari window (light/dark), continuous (squircle) corners.
Mobile  -> an iPhone 17 Pro: 402x874 pt, 62 pt continuous display corners,
           62 pt status bar with iOS glyphs, 125x37.33 pt Dynamic Island,
           thin uniform bezel, home indicator. Specs researched, not guessed.

Both output transparent PNGs with a baked soft shadow so they float anywhere.
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")
OUT = os.path.join(HERE, "out")
# Real Apple system fonts (SF Pro Text + SF Symbols 7). Not committed - Apple
# licensed - so `./fonts.sh` fetches them from Apple into ./fonts/ on demand.
SF_SB = os.path.join(HERE, "fonts", "SF-Pro-Text-Semibold.otf")
SF_RG = os.path.join(HERE, "fonts", "SF-Pro-Text-Regular.otf")
SF_SYM = os.path.join(HERE, "fonts", "SF-Symbols.otf")

LIGHTS = [(255, 95, 87), (254, 188, 46), (40, 200, 64)]
LIGHT_RING = [(224, 70, 62), (222, 160, 25), (26, 170, 45)]

# Real SF Symbols, addressed by their private-use codepoints in Apple's symbol
# font (identified by rendering + visual confirmation; Apple ships no name map).
SYM = {
    "wifi": 0x100647,
    "battery.100": 0x1006E8,
    "cellularbars": 0x100B67,
    "chevron.left": 0x100189,
    "chevron.right": 0x10018A,
    "plus": 0x10017C,
    "square.and.arrow.up": 0x100203,
    "square.on.square": 0x1003E7,
    "sidebar.left": 0x1003DA,
    "lock.fill": 0x1003A1,
    "chevron.down": 0x100188,
    "arrow.clockwise": 0x10037F,
    "shield.fill": 0x100667,
}


def sym(d, name, xy, size, fill, anchor="mm"):
    """Draw a real SF Symbol glyph."""
    d.text(xy, chr(SYM[name]), font=ImageFont.truetype(SF_SYM, size), fill=fill, anchor=anchor)

# Safari 26 (macOS Tahoe, "Liquid Glass"): a translucent toolbar with floating
# rounded capsules. Values sampled from Apple's own Safari screenshots.
SAFARI = {
    "light": {
        "bar": (242, 242, 245), "sep": (0, 0, 0, 18),
        "cap": (255, 255, 255), "cap_edge": (0, 0, 0, 20),
        "text": (29, 29, 31), "icon": (44, 44, 48), "icon_dim": (178, 178, 184),
        "border": (0, 0, 0, 45),
    },
    "dark": {
        "bar": (35, 36, 40), "sep": (255, 255, 255, 16),
        "cap": (54, 56, 62), "cap_edge": (255, 255, 255, 22),
        "text": (232, 232, 236), "icon": (226, 226, 231), "icon_dim": (110, 112, 119),
        "border": (255, 255, 255, 30),
    },
}


def squircle_points(w, h, r, n=5.0, steps=28):
    def corner(cx, cy, a0, a1):
        out = []
        for i in range(steps + 1):
            t = math.radians(a0 + (a1 - a0) * i / steps)
            ct, st = math.cos(t), math.sin(t)
            out.append((cx + r * math.copysign(abs(ct) ** (2 / n), ct),
                        cy + r * math.copysign(abs(st) ** (2 / n), st)))
        return out
    pts = []
    pts += corner(w - r, r, -90, 0)
    pts += corner(w - r, h - r, 0, 90)
    pts += corner(r, h - r, 90, 180)
    pts += corner(r, r, 180, 270)
    return pts


def squircle_mask(size, r, n=5.0, ssf=2):
    w, h = size
    big = Image.new("L", (w * ssf, h * ssf), 0)
    ImageDraw.Draw(big).polygon(squircle_points(w * ssf, h * ssf, r * ssf, n), fill=255)
    return big.resize((w, h), Image.LANCZOS)


def rounded_mask(size, r):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], r, fill=255)
    return m


def vgrad(w, h, top, bot):
    base = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / max(1, h - 1)
        base.putpixel((0, y), tuple(round(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return base.resize((w, h))


def shadow(win, pad, blur, dy, alpha, mask):
    w, h = win.size
    cw, ch = w + pad * 2, h + pad * 2 + dy
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    sh = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    silhouette = Image.new("RGBA", win.size, (0, 0, 0, alpha))
    silhouette.putalpha(Image.eval(mask, lambda a: a * alpha // 255))
    sh.alpha_composite(silhouette, (pad, pad + dy))
    canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(win, (pad, pad))
    return canvas


def fit(img, final_w):
    if final_w and img.size[0] > final_w:
        return img.resize((final_w, round(img.size[1] * final_w / img.size[0])), Image.LANCZOS)
    return img


# ---------------------------------------------------------------- desktop Safari
def safari(name, scheme, host="dave.composery.cloud", s=2, final_w=2600):
    """A macOS Tahoe Safari 26 window, rebuilt against Apple's own screenshots."""
    c = SAFARI[scheme]
    src = Image.open(f"{RAW}/{scheme}/{name}.png").convert("RGBA")
    w, h = src.size
    bar, r = 56 * s, 12 * s
    win = Image.new("RGBA", (w, h + bar), c["bar"] + (255,))
    win.paste(src, (0, bar))
    ov = Image.new("RGBA", win.size, (0, 0, 0, 0))   # alpha-capable overlay
    d = ImageDraw.Draw(ov)
    d.line([(0, bar - 1), (w, bar - 1)], fill=c["sep"], width=max(1, s))

    cy = bar // 2
    caph = 32 * s                                     # Liquid Glass capsule height
    icon, dim, isz = c["icon"], c["icon_dim"], round(17 * s)

    def capsule(x0, x1):
        d.rounded_rectangle([x0, cy - caph // 2, x1, cy + caph // 2], caph // 2,
                            fill=c["cap"] + (255,), outline=c["cap_edge"], width=max(1, s))

    lr, x = 6 * s, 20 * s
    for col, ring in zip(LIGHTS, LIGHT_RING):
        d.ellipse([x - lr, cy - lr, x + lr, cy + lr], fill=col, outline=ring, width=max(1, s // 2))
        x += 20 * s

    # sidebar capsule: sidebar.left + chevron.down
    capsule(86 * s, 136 * s)
    sym(d, "sidebar.left", (103 * s, cy), isz, icon)
    sym(d, "chevron.down", (123 * s, cy), round(10 * s), icon)

    # back / forward capsule, with a divider
    capsule(146 * s, 208 * s)
    sym(d, "chevron.left", (165 * s, cy), round(15 * s), icon)
    d.line([(177 * s, cy - 8 * s), (177 * s, cy + 8 * s)], fill=c["cap_edge"], width=max(1, s))
    sym(d, "chevron.right", (190 * s, cy), round(15 * s), dim)

    # privacy shield (circular glass button)
    scx = 230 * s
    d.ellipse([scx - caph // 2, cy - caph // 2, scx + caph // 2, cy + caph // 2],
              fill=c["cap"] + (255,), outline=c["cap_edge"], width=max(1, s))
    sym(d, "shield.fill", (scx, cy), round(15 * s), icon)

    # address pill: domain centred, reload inside on the right
    fw2, fh = int(w * 0.42), 34 * s
    fx0 = (w - fw2) // 2
    d.rounded_rectangle([fx0, cy - fh // 2, fx0 + fw2, cy + fh // 2], fh // 2,
                        fill=c["cap"] + (255,), outline=c["cap_edge"], width=max(1, s))
    font = ImageFont.truetype(SF_RG, round(15 * s))
    d.text((w // 2, cy - 1), host, font=font, fill=c["text"], anchor="mm")
    sym(d, "arrow.clockwise", (fx0 + fw2 - 14 * s, cy), round(14 * s), dim, anchor="rm")

    # right capsule: share, new tab, tab overview
    rx0, rx1 = w - 140 * s, w - 20 * s
    capsule(rx0, rx1)
    sym(d, "square.and.arrow.up", (rx0 + 22 * s, cy - 1 * s), isz, icon)
    sym(d, "plus", (rx0 + 60 * s, cy), round(18 * s), icon)
    sym(d, "square.on.square", (rx0 + 98 * s, cy), isz, icon)

    win = Image.alpha_composite(win, ov)
    m = squircle_mask(win.size, r)
    win.putalpha(m)
    pts = squircle_points(*win.size, r)
    ImageDraw.Draw(win).line(pts + [pts[0]], fill=c["border"], width=max(1, s), joint="curve")
    out = fit(shadow(win, 60 * s, 32 * s, 20 * s, 110, m), final_w)
    os.makedirs(f"{OUT}/{scheme}", exist_ok=True)
    out.save(f"{OUT}/{scheme}/{name}.png")
    print("safari", scheme, name, out.size)


# ------------------------------------------------------------------ iOS statusbar
def status_bar(w, s, txt):
    """iOS status bar: SF Pro Text time + real SF Symbols glyphs."""
    ov = Image.new("RGBA", (w, round(62 * s)), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    cy = round(30 * s)
    fg = txt + (255,)
    d.text((round(68 * s), cy), "9:41", font=ImageFont.truetype(SF_SB, round(17 * s)),
           fill=fg, anchor="mm")
    # Right cluster, laid out right-to-left. Advance by each glyph's measured
    # width so they never collide.
    x = w - round(30 * s)
    for name, size in (("battery.100", round(17 * s)),
                       ("wifi", round(16 * s)),
                       ("cellularbars", round(16 * s))):
        f = ImageFont.truetype(SF_SYM, size)
        g = chr(SYM[name])
        d.text((x, cy), g, font=f, fill=fg, anchor="rm")
        x -= d.textlength(g, font=f) + round(5 * s)
    return ov


def iphone(name, scheme, s=3, final_w=780):
    src = Image.open(f"{RAW}/{scheme}/{name}.png").convert("RGBA")
    w, hh = src.size
    dark = scheme == "dark"
    txt = (255, 255, 255) if dark else (22, 22, 24)
    app_bg = src.getpixel((4, 4))[:3]

    SB, BOTTOM = round(62 * s), round(34 * s)
    screen = Image.new("RGBA", (w, SB + hh + BOTTOM), app_bg + (255,))
    screen.paste(src, (0, SB))
    screen.alpha_composite(status_bar(w, s, txt), (0, 0))
    d = ImageDraw.Draw(screen)

    diw, dih = round(125 * s), round(37.33 * s)
    dix, diy = (w - diw) // 2, round(11 * s)
    d.rounded_rectangle([dix, diy, dix + diw, diy + dih], dih // 2, fill=(0, 0, 0))
    cr = round(4.5 * s)
    ccx, ccy = dix + diw - round(21 * s), diy + dih // 2
    d.ellipse([ccx - cr, ccy - cr, ccx + cr, ccy + cr], fill=(17, 17, 21))

    ov = Image.new("RGBA", screen.size, (0, 0, 0, 0))
    hiw, hih = round(140 * s), round(5 * s)
    hix, hiy = (w - hiw) // 2, screen.size[1] - round(9 * s) - hih
    ImageDraw.Draw(ov).rounded_rectangle([hix, hiy, hix + hiw, hiy + hih], hih // 2,
                                         fill=(255, 255, 255, 150) if dark else (0, 0, 0, 140))
    screen = Image.alpha_composite(screen, ov)
    screen.putalpha(squircle_mask(screen.size, round(62 * s)))

    # Border geometry, all from Apple's published numbers. At 460ppi the
    # 1206x2622 active area is 66.59x144.78mm inside a 71.9x150.0mm body, so the
    # uniform border is 2.63mm = 15.9pt. Apple's accessory guidelines put the
    # iPhone 17 Pro *bezel* at 1.44mm (8.7pt); the remaining 1.19mm (7.2pt) is
    # the aluminium rail, which reads as metal head-on, not black. Corners are
    # concentric: rail 78pt -> bezel 69.3pt -> display 62pt.
    RAIL, BEZ = round(7.2 * s), round(8.7 * s)
    bez = RAIL + BEZ                                     # 15.9pt total inset
    bw2, bh2 = w + bez * 2, screen.size[1] + bez * 2

    body = Image.new("RGBA", (bw2, bh2), (0, 0, 0, 0))
    # Black. The rail and the bezel read as one thin dark edge - no tint, no
    # chrome band, just the phone.
    rail = Image.new("RGBA", (bw2, bh2), (26, 26, 28, 255))
    rail.putalpha(squircle_mask((bw2, bh2), round(78 * s)))
    body = Image.alpha_composite(body, rail)
    # the faintest edge highlight so the silhouette reads on a dark page
    hl = Image.new("RGBA", (bw2, bh2), (0, 0, 0, 0))
    ImageDraw.Draw(hl).line(squircle_points(bw2, bh2, round(78 * s)) + [squircle_points(bw2, bh2, round(78 * s))[0]],
                            fill=(120, 120, 126, 90), width=max(1, s), joint="curve")
    body = Image.alpha_composite(body, hl)
    # black bezel under the glass
    fw3, fh3 = bw2 - RAIL * 2, bh2 - RAIL * 2
    face = Image.new("RGBA", (fw3, fh3), (9, 9, 11, 255))
    face.putalpha(squircle_mask((fw3, fh3), round(78 * s) - RAIL))
    body.alpha_composite(face, (RAIL, RAIL))

    # side buttons, sitting on the rail
    bd = ImageDraw.Draw(body)
    btn = (44, 44, 47)
    for y0, y1 in ((116, 150), (170, 206), (218, 254)):        # action, volume up/down
        bd.rounded_rectangle([-round(1.5 * s), round(y0 * s), round(2 * s), round(y1 * s)], round(1.5 * s), fill=btn)
    bd.rounded_rectangle([bw2 - round(2 * s), round(188 * s), bw2 + round(1.5 * s), round(258 * s)], round(1.5 * s), fill=btn)

    body.alpha_composite(screen, (bez, bez))
    m = squircle_mask(body.size, round(78 * s))
    out = fit(shadow(body, 52 * s, 30 * s, 18 * s, 120, m), final_w)
    os.makedirs(f"{OUT}/{scheme}", exist_ok=True)
    out.save(f"{OUT}/{scheme}/{name}.png")
    print("iphone", scheme, name, out.size)


if __name__ == "__main__":
    for scheme in ("dark", "light"):
        for n in ("editor-terminal", "welcome", "editor"):
            safari(n, scheme)
        for n in ("mobile-welcome", "mobile-editor", "mobile-terminal"):
            iphone(n, scheme)
    print("done")
