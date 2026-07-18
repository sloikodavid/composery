"""Frame raw Composery captures into realistic macOS/iOS marketing PNGs.

Desktop -> a 14" MacBook Pro (M5) glass front: 1512x982 pt display on the real
           macOS Tahoe wallpaper, transparent Tahoe menu bar wrapping the
           208x37 pt notch, and our capture inside a faithful Safari 26 window
           (Liquid Glass toolbar, 22 pt corners) floating on that desktop.
Mobile  -> an iPhone 17 Pro glass front: 402x874 pt display, 62 pt corners, a
           1.44 mm black bezel and nothing else, 62 pt status bar with iOS
           glyphs, 125x37.33 pt Dynamic Island, home indicator.

Every number here was measured or taken from Apple, not guessed. Corners are
CIRCULAR everywhere: superellipse fits against Apple's own renders (iPhone 17
Pro, Safari window, MacBook display corner) all land on exponent 2.0. A
squircle reads as a brick.

Output is transparent PNGs with a light baked shadow, so they float on any page.
"""
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

# Drop shadows. Set False for flat frames with nothing but their own edge.
SHADOW = True

# Tuned per object, because they are not the same object. Sizes are in points
# (scaled by s), alpha is 0-255. Both frames end as a hard black border on the
# page, so both want a tight-ish grounding shadow rather than a halo - the lid
# is 2.4x the phone's width, so its shadow is broader and softer in absolute
# terms while staying proportionally tighter.
MACBOOK_SHADOW = {"pad": 56, "blur": 30, "dy": 12, "alpha": 48}
PHONE_SHADOW = {"pad": 52, "blur": 22, "dy": 12, "alpha": 55}

# macOS window corner, measured off Apple's own Safari screenshot using the
# traffic lights (12 pt each) as the ruler: circular, r = 22.5 pt. Tahoe's
# windows are much rounder than the old 10-12 pt.
WINDOW_R = 22

# 14" MacBook Pro, in points (@2x, 254 ppi: 1 pt = 0.2 mm). Display and notch
# geometry measured off Apple's straight-on macOS Tahoe lock-screen render
# (the notch is the same physical size on the 14" and 16", so the 16" render
# measures transfer 1:1 in points). The lid is drawn like the iPhone: display
# + black glass border only, no aluminium body, no hinge.
#
#   display        3024x1964 px = 1512x982 pt, top corners r 20.5 pt (fit rms
#                  0.43 px, circular), bottom corners square
#   menu bar band  37 pt - the area beside the notch; below it is exact 16:10
#   notch          208x37 pt, bottom corners r 9 pt, top square into the bezel
#   bezel          3.5 mm = 17.5 pt, Apple's own keynote figure for sides and
#                  top. The full display-to-body border is 5.1 mm, but 1.6 mm
#                  of that is aluminium rim - not drawn, like the iPhone rail.
#   chin           60 pt. The render measures 70 pt of dark, but the same
#                  render over-measures the side bezel by ~9 pt (edge blur +
#                  the rim reading dark), so the chin gets the same correction.
#   lid corner     concentric with the display corner: 20.5 + 17.5 = 38 pt
MBP_W, MBP_H = 1512, 982
MENU = 37
MBP_DISPLAY_R = 20.5
MBP_BEZEL = 17.5
MBP_CHIN = 60
LID_R = MBP_DISPLAY_R + MBP_BEZEL
NOTCH_W, NOTCH_R = 208, 9

# What a real 14" desktop shows: the Safari window floats over the wallpaper
# with macOS's big soft window shadow (this one is baked into the screen, not
# the page shadow around the lid).
DESKTOP_WINDOW = {"content_w": 1248, "blur": 26, "dy": 10, "alpha": 105}

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

# iPhone 17 Pro, in points (@3x). We draw the glass front only - the display and
# its black bezel - with no aluminium shell around it.
#
# Apple's full body border is 16 pt ((71.9 - 66.59 mm)/2), but only 1.44 mm of
# that is the black bezel; the rest is the metal rail. Drawing the rail is what
# made it look like a phone-shaped brick, so the bezel alone is the border here.
# DISPLAY_R is the OS-reported display corner radius; BODY_R is concentric.
# Corners are circular - fitting Apple's own 17 Pro render gives exponent 2.0.
DISPLAY_R = 62
BEZEL = 8.7  # 1.44 mm, Apple's published iPhone 17 Pro bezel
BODY_R = DISPLAY_R + BEZEL  # 70.7

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
    "magnifyingglass": 0x1002AB,
    "switch.2": 0x10070A,
    "shift": 0x10019D,
    "delete.left": 0x10019B,
    "return": 0x100147,
    "mic": 0x1002B0,
}

# The Apple menu logo is regular Unicode PUA in every Apple text font.
APPLE_LOGO = chr(0xF8FF)


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


def rounded_mask(size, r, ssf=2):
    """Circular rounded rect, supersampled - PIL's own corners are not antialiased."""
    w, h = size
    big = Image.new("L", (w * ssf, h * ssf), 0)
    ImageDraw.Draw(big).rounded_rectangle(
        [0, 0, w * ssf - 1, h * ssf - 1], r * ssf, fill=255)
    return big.resize((w, h), Image.LANCZOS)


def shadow(win, s, cfg, mask):
    """Place the frame on a transparent canvas, with or without a drop shadow.

    The padding is kept either way, so the phone trio spaces itself the same.
    """
    pad, blur, dy = (round(cfg[k] * s) for k in ("pad", "blur", "dy"))
    alpha = cfg["alpha"]
    w, h = win.size
    cw, ch = w + pad * 2, h + pad * 2 + dy
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    if SHADOW:
        sh = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
        silhouette = Image.new("RGBA", win.size, (0, 0, 0, alpha))
        silhouette.putalpha(Image.eval(mask, lambda a: a * alpha // 255))
        sh.alpha_composite(silhouette, (pad, pad + dy))
        canvas = Image.alpha_composite(canvas, sh.filter(ImageFilter.GaussianBlur(blur)))
    canvas.alpha_composite(win, (pad, pad))
    return canvas


def edge(size, r, w):
    """An antialiased hairline ring just inside a circular rounded rect."""
    outer = rounded_mask(size, r)
    inner = Image.new("L", size, 0)
    inner.paste(rounded_mask((size[0] - 2 * w, size[1] - 2 * w), max(0, r - w)), (w, w))
    return ImageChops.subtract(outer, inner)


def rim(img, r, s, dark):
    """A faint top-lit rim highlight on the frame's outer edge, dark UI only.

    The dark shots sit on near-black pages where a black bezel has no
    silhouette and a drop shadow does nothing - the same reason Apple's own
    dark-background renders carry an edge highlight. Light shots skip it; the
    shadow does the separating there.
    """
    if not dark:
        return img
    w, h = img.size
    ring = edge((w, h), r, max(1, round(0.8 * s)))
    grad = Image.linear_gradient("L").resize((w, h)).point(lambda v: 64 - 46 * v // 255)
    lay = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    lay.putalpha(ImageChops.multiply(ring, grad))
    return Image.alpha_composite(img, lay)


def fit(img, final_w):
    if final_w and img.size[0] > final_w:
        return img.resize((final_w, round(img.size[1] * final_w / img.size[0])), Image.LANCZOS)
    return img


# ---------------------------------------------------------------- desktop Safari
def safari_window(name, scheme, host="my-box.composery.cloud", s=2, content_w=None):
    """A macOS Tahoe Safari 26 window, rebuilt against Apple's own screenshots.

    Returns the finished window and its alpha mask; macbook() puts it on the
    desktop. The capture is scaled to content_w pt first, while all the chrome
    stays at true point size, exactly like a real window on a 14" display.
    """
    c = SAFARI[scheme]
    src = Image.open(f"{RAW}/{scheme}/{name}.png").convert("RGBA")
    if content_w:
        cw = round(content_w * s)
        src = src.resize((cw, round(src.size[1] * cw / src.size[0])), Image.LANCZOS)
    w, h = src.size
    bar, r = 56 * s, round(WINDOW_R * s)
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

    # Blend the hairline edge into the window, then round it off. Circular, not a
    # squircle - macOS windows fit a plain arc (see WINDOW_R).
    br, bgc, bbl, ba = c["border"]
    ring = Image.new("RGBA", win.size, (br, bgc, bbl, 0))
    ring.putalpha(Image.eval(edge(win.size, r, max(1, s)), lambda v: v * ba // 255))
    win = Image.alpha_composite(win, ring)

    m = rounded_mask(win.size, r)
    win.putalpha(m)
    return win, m


# ---------------------------------------------------------------- macOS desktop
_WALLPAPER = {}


def wallpaper(scheme, size):
    """The real macOS Tahoe default wallpaper (fetched by fonts.sh, like the
    Apple fonts), center-cropped the way macOS fills the display from the
    square original."""
    if (scheme, size) not in _WALLPAPER:
        src = Image.open(os.path.join(HERE, "wallpapers", f"tahoe-{scheme}.png"))
        w, h = src.size
        ch = round(w * size[1] / size[0])
        top = (h - ch) // 2
        _WALLPAPER[(scheme, size)] = (
            src.crop((0, top, w, top + ch)).resize(size, Image.LANCZOS).convert("RGBA"))
    return _WALLPAPER[(scheme, size)].copy()


def menu_bar(s):
    """The Tahoe menu bar: no background at all, white SF Pro text and real SF
    Symbols straight on the wallpaper, with the soft legibility shadow macOS
    puts under them. Layout gaps measured off Apple's Control Center shot."""
    w, h = round(MBP_W * s), round(MENU * s)
    glyphs = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(glyphs)
    cy = h // 2
    white = (255, 255, 255, 242)

    f13, fsb = ImageFont.truetype(SF_RG, round(13 * s)), ImageFont.truetype(SF_SB, round(13 * s))
    x = round(16 * s)
    d.text((x, cy), APPLE_LOGO, font=ImageFont.truetype(SF_RG, round(14 * s)),
           fill=white, anchor="lm")
    x += d.textlength(APPLE_LOGO, font=ImageFont.truetype(SF_RG, round(14 * s))) + round(21 * s)
    for i, item in enumerate(("Safari", "File", "Edit", "View", "History",
                              "Bookmarks", "Window", "Help")):
        f = fsb if i == 0 else f13
        d.text((x, cy), item, font=f, fill=white, anchor="lm")
        x += d.textlength(item, font=f) + round(21 * s)

    # Status items, right-to-left: clock, Control Center, Spotlight, Wi-Fi,
    # battery - the stock Tahoe set, in Apple's own order.
    x = w - round(16 * s)
    clock = "Tue Jul 14  9:41 AM"
    d.text((x, cy), clock, font=f13, fill=white, anchor="rm")
    x -= d.textlength(clock, font=f13) + round(22 * s)
    for name, size in (("switch.2", 16), ("magnifyingglass", 15),
                       ("wifi", 16), ("battery.100", 21)):
        f = ImageFont.truetype(SF_SYM, round(size * s))
        g = chr(SYM[name])
        d.text((x, cy), g, font=f, fill=white, anchor="rm")
        x -= d.textlength(g, font=f) + round(22 * s)

    ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sh.putalpha(Image.eval(glyphs.getchannel("A"), lambda a: a * 90 // 255))
    ov.alpha_composite(sh.filter(ImageFilter.GaussianBlur(round(1.5 * s))), (0, round(0.5 * s)))
    ov.alpha_composite(glyphs)
    return ov


def macbook(name, scheme, s=2, final_w=2600):
    """The full 14" MacBook Pro glass front around a Tahoe desktop."""
    sw, sh = round(MBP_W * s), round(MBP_H * s)
    screen = wallpaper(scheme, (sw, sh))

    # Safari floating on the desktop, with macOS's own big soft window shadow.
    win, wmask = safari_window(name, scheme, s=s, content_w=DESKTOP_WINDOW["content_w"])
    wx = (sw - win.size[0]) // 2
    wy = round(MENU * s) + (sh - round(MENU * s) - win.size[1]) // 2
    lay = Image.new("RGBA", screen.size, (0, 0, 0, 0))
    sil = Image.new("RGBA", win.size, (0, 0, 0, 0))
    sil.putalpha(Image.eval(wmask, lambda a: a * DESKTOP_WINDOW["alpha"] // 255))
    lay.alpha_composite(sil, (wx, wy + round(DESKTOP_WINDOW["dy"] * s)))
    screen.alpha_composite(lay.filter(ImageFilter.GaussianBlur(round(DESKTOP_WINDOW["blur"] * s))))
    screen.alpha_composite(win, (wx, wy))
    screen.alpha_composite(menu_bar(s))

    # The notch: square into the bezel on top, 9 pt rounded corners into the
    # menu bar band, camera as a barely-there darker disc.
    nw, nh, nr = round(NOTCH_W * s), round(MENU * s), NOTCH_R * s
    nx = (sw - nw) // 2
    notch = Image.new("RGBA", (nw, nh), (10, 10, 12, 255))
    nm = Image.new("L", (nw * 2, nh * 2), 0)
    ImageDraw.Draw(nm).rounded_rectangle([0, 0, nw * 2 - 1, nh * 2 - 1], nr * 2,
                                         fill=255, corners=(False, False, True, True))
    notch.putalpha(nm.resize((nw, nh), Image.LANCZOS))
    screen.alpha_composite(notch, (nx, 0))
    dd = ImageDraw.Draw(screen)
    ccx, ccy, cr = sw // 2, round(18.5 * s), round(4.5 * s)
    dd.ellipse([ccx - cr, ccy - cr, ccx + cr, ccy + cr], fill=(17, 17, 20))

    # Display corners: round on top, square at the bottom - mask a taller
    # rounded rect and crop the bottom rounding away.
    dr = round(MBP_DISPLAY_R * s)
    screen.putalpha(rounded_mask((sw, sh + dr), dr).crop((0, 0, sw, sh)))

    # The lid: one black glass border, thin around the display, tall at the
    # chin, nothing else - same treatment as the iPhone.
    bez, chin = round(MBP_BEZEL * s), round(MBP_CHIN * s)
    lw, lh = sw + bez * 2, sh + bez + chin
    lid = Image.new("RGBA", (lw, lh), (10, 10, 12, 255))
    lm = rounded_mask((lw, lh), round(LID_R * s))
    lid.putalpha(lm)
    lid.alpha_composite(screen, (bez, bez))
    lid = rim(lid, round(LID_R * s), s, scheme == "dark")

    out = fit(shadow(lid, s, MACBOOK_SHADOW, lm), final_w)
    os.makedirs(f"{OUT}/{scheme}", exist_ok=True)
    out.save(f"{OUT}/{scheme}/{name}.png")
    print("macbook", scheme, name, out.size)


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


# ------------------------------------------------------------------ iOS keyboard
# The iOS 26 keyboard, measured off Apple's own Live Translation press shot
# (iPhone 16 Pro - the same 402x874 pt canvas as the 17 Pro, so everything
# transfers 1:1):
#
#   panel        top at 535 pt (339 pt tall), flat fill, 1 pt bright top
#                hairline, ~26 pt rounded top corners, 1.5 pt side inset
#   strip        57 pt QuickType bar, empty (a terminal has no predictions),
#                dividers at thirds
#   letter keys  33x41.8 pt, corner r 8.75 (fit), 6.5 pt gaps, 7.7 pt margins,
#                rows at 592.1 / 647.1 / 702.1 / 757 pt, 13.2 pt between rows
#   modifiers    shift + backspace 44.1 pt; 123 / space / return are
#                91.6 / 190.1 / 91.6 pt - the space bar is unlabeled in 26,
#                return is a glyph, and every key is the same material
#   below panel  emoji + mic glyphs centred 49.5 pt from each edge, y 830
#
# All glyphs are the real SF Symbols (matched from the same shot); the emoji
# key's grinning face is UIKit artwork with no SF Symbol, so it is drawn to
# match. Light colors are sampled from Apple's shot. Apple publishes no dark
# keyboard screenshot, so dark keeps the measured geometry with the standard
# iOS dark key material (unchanged since iOS 13) composited over our app.
KB_H = 339
KB = {
    "light": {"bg": (242, 242, 242), "key": (255, 255, 255), "ink": (10, 10, 11),
              "icon": (70, 70, 70), "div": (0, 0, 0, 30), "rim": (255, 255, 255, 200),
              "shadow": (0, 0, 0, 34)},
    "dark": {"bg": (33, 33, 36), "key": (104, 104, 108), "ink": (249, 249, 251),
             "icon": (196, 196, 201), "div": (255, 255, 255, 28), "rim": (255, 255, 255, 26),
             "shadow": (0, 0, 0, 80)},
}


def kb_smiley(d, cx, cy, S, ink):
    """The keyboard's grinning emoji face (UIKit artwork, not an SF Symbol)."""
    r, t = 11.1 * S, round(2.2 * S)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ink, width=t)
    er = 1.7 * S
    for dx in (-4.3, 4.3):
        ex = cx + dx * S
        d.ellipse([ex - er, cy - 3.4 * S - er, ex + er, cy - 3.4 * S + er], fill=ink)
    # open smile: dark mouth, white teeth band across its top
    mw, mtop, mbot = 6.4 * S, cy + 0.4 * S, cy + 8.6 * S
    d.pieslice([cx - mw, mtop - (mbot - mtop), cx + mw, mbot], 0, 180, fill=ink)
    tw = 4.6 * S
    d.pieslice([cx - tw, mtop + 1.2 * S - (mbot - mtop) * 0.55, cx + tw,
                mtop + 1.2 * S + (mbot - mtop) * 0.55], 0, 180, fill=(255, 255, 255, 255))
    d.pieslice([cx - tw, mtop + 3.4 * S - (mbot - mtop) * 0.45, cx + tw,
                mtop + 3.4 * S + (mbot - mtop) * 0.45], 0, 180, fill=ink)


def keyboard(s, scheme):
    """Render the keyboard panel, supersampled 2x for the key corners."""
    c = KB[scheme]
    ss = 2
    S = s * ss
    w, h = round(402 * S), round(KB_H * S)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = c["ink"] + (255,)

    # Panel: rounded top corners, bottom bleeds off the canvas, a bright
    # hairline along the top edge (the Liquid Glass rim).
    inset, pr = round(1.5 * S), round(26 * S)
    panel = [inset, 0, w - 1 - inset, h - 1 + pr]
    d.rounded_rectangle(panel, pr, fill=c["bg"] + (255,))
    rim_lay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(rim_lay).rounded_rectangle(panel, pr, outline=c["rim"], width=max(1, S // 2))
    fade = Image.linear_gradient("L").resize(img.size).point(lambda v: max(0, 255 - v * 5))
    rim_lay.putalpha(ImageChops.multiply(rim_lay.getchannel("A"), fade))
    img = Image.alpha_composite(img, rim_lay)
    d = ImageDraw.Draw(img)

    # Empty QuickType strip with its thirds dividers.
    for xd in (134, 268):
        d.rectangle([round(xd * S), round(14 * S), round(xd * S) + max(1, S // 2),
                     round(43 * S)], fill=c["div"])

    def key(x, y, kw, kh=41.8):
        sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle(
            [round(x * S), round((y + 1) * S), round((x + kw) * S), round((y + kh + 1) * S)],
            round(8.75 * S), fill=c["shadow"])
        img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(S // 2)))
        d.rounded_rectangle(
            [round(x * S), round(y * S), round((x + kw) * S), round((y + kh) * S)],
            round(8.75 * S), fill=c["key"] + (255,))
        return x + kw / 2, y + kh / 2

    m, g, kw = 7.7, 6.5, (402 - 2 * 7.7 - 9 * 6.5) / 10
    rows_y = [57.1, 112.1, 167.1, 222.0]   # panel-relative (592.1 - 535, ...)
    letter_f = ImageFont.truetype(SF_RG, round(23.5 * S))

    for i, ch in enumerate("qwertyuiop"):
        cx, cy = key(m + i * (kw + g), rows_y[0], kw)
        d.text((cx * S, cy * S), ch, font=letter_f, fill=ink, anchor="mm")
    for i, ch in enumerate("asdfghjkl"):
        cx, cy = key(m + (kw + g) / 2 + i * (kw + g), rows_y[1], kw)
        d.text((cx * S, cy * S), ch, font=letter_f, fill=ink, anchor="mm")
    for i, ch in enumerate("zxcvbnm"):
        cx, cy = key(67.0 + i * (kw + g), rows_y[2], kw)
        d.text((cx * S, cy * S), ch, font=letter_f, fill=ink, anchor="mm")

    def glyph(name, cx, cy, size):
        d.text((cx * S, cy * S), chr(SYM[name]),
               font=ImageFont.truetype(SF_SYM, round(size * S)), fill=ink, anchor="mm")

    cx, cy = key(m, rows_y[2], 44.1)
    glyph("shift", cx, cy, 25)
    cx, cy = key(402 - m - 44.1, rows_y[2], 44.1)
    glyph("delete.left", cx, cy, 25)

    cx, cy = key(m, rows_y[3], 91.6)
    d.text((cx * S, cy * S), "123", font=ImageFont.truetype(SF_RG, round(17 * S)),
           fill=ink, anchor="mm")
    key(105.9, rows_y[3], 190.1)                 # space: unlabeled in iOS 26
    cx, cy = key(302.9, rows_y[3], 91.6)
    glyph("return", cx, cy, 25)

    # Below the panel: emoji + mic, no keys.
    icon = c["icon"] + (255,)
    kb_smiley(d, round(49.5 * S), round(295 * S), S, icon)
    d.text((round(352.5 * S), round(295 * S)), chr(SYM["mic"]),
           font=ImageFont.truetype(SF_SYM, round(27 * S)), fill=icon, anchor="mm")

    return img.resize((round(402 * s), round(KB_H * s)), Image.LANCZOS)


def iphone(name, scheme, s=3, final_w=780):
    src = Image.open(f"{RAW}/{scheme}/{name}.png").convert("RGBA")
    w, hh = src.size
    dark = scheme == "dark"
    txt = (255, 255, 255) if dark else (22, 22, 24)
    app_bg = src.getpixel((4, 4))[:3]

    # The terminal shot is captured at the keyboard-open viewport (473 pt) and
    # gets the measured iOS 26 keyboard composited below it, exactly where iOS
    # puts it. The other shots keep the 34 pt bottom safe area.
    SB, BOTTOM = round(62 * s), round(34 * s)
    if name == "mobile-terminal":
        kb = keyboard(s, scheme)
        screen = Image.new("RGBA", (w, SB + hh + kb.size[1]), app_bg + (255,))
        screen.paste(src, (0, SB))
        screen.alpha_composite(kb, (0, SB + hh))
    else:
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
    screen.putalpha(rounded_mask(screen.size, round(DISPLAY_R * s)))

    # One uniform black bezel - nothing else. On a black iPhone the aluminium
    # rail is black too, so the border reads as a single band; drawing a separate
    # tinted rail just looks like a second frame.
    #
    # Geometry is Apple's own: at 460 ppi the 1206x2622 active area is
    # 66.59 x 144.78 mm inside a 71.9 x 150.0 mm body, so the border is
    # 2.63 mm = 16 pt, uniform. Corners are concentric and CIRCULAR: fitting a
    # superellipse to Apple's own iPhone 17 Pro render lands on n = 2.0 (a plain
    # circular arc) - a squircle here reads as a brick.
    bez = round(BEZEL * s)
    bw2, bh2 = w + bez * 2, screen.size[1] + bez * 2

    body = Image.new("RGBA", (bw2, bh2), (10, 10, 12, 255))
    body.putalpha(rounded_mask((bw2, bh2), round(BODY_R * s)))
    body.alpha_composite(screen, (bez, bez))
    body = rim(body, round(BODY_R * s), s, dark)
    m = rounded_mask(body.size, round(BODY_R * s))
    out = fit(shadow(body, s, PHONE_SHADOW, m), final_w)
    os.makedirs(f"{OUT}/{scheme}", exist_ok=True)
    out.save(f"{OUT}/{scheme}/{name}.png")
    print("iphone", scheme, name, out.size)


if __name__ == "__main__":
    for scheme in ("dark", "light"):
        for n in ("ide", "welcome", "editor"):
            macbook(n, scheme)
        for n in ("mobile-welcome", "mobile-editor", "mobile-terminal"):
            iphone(n, scheme)
    print("done")
