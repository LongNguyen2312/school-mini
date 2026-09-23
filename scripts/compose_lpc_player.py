#!/usr/bin/env python3
"""Compose an LPC male character into public/assets/player.png for Phaser."""

from __future__ import annotations

import json
from pathlib import Path

import math

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
LPC = Path("/tmp/lpc/Universal-LPC-Spritesheet-Character-Generator-master")
SHEETS = LPC / "spritesheets"
PAL = LPC / "palette_definitions"
OUT = ROOT / "public" / "assets" / "player.png"
OUT_BALD = ROOT / "public" / "assets" / "player_bald.png"
CREDITS = ROOT / "public" / "assets" / "LPC_CREDITS.txt"
PREVIEW = ROOT / "public" / "assets" / "_lpc_preview.png"

FRAME = 64
UPSCALE = 1  # keep native LPC pixels — Phaser scales with nearest-neighbor
PF = FRAME * UPSCALE
COLS = 9

# LPC row order
DIR = {"up": 0, "left": 1, "down": 2, "right": 3}


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def load_palette(kind: str, name: str) -> dict[str, list[tuple[int, int, int]]]:
    path = PAL / kind / f"{kind}_ulpc.json"
    data = json.loads(path.read_text())
    return {k: [hex_rgb(c) for c in v] for k, v in data.items()}


def recolor(
    im: Image.Image,
    src: list[tuple[int, int, int]],
    dst: list[tuple[int, int, int]],
    tol: int = 2,
) -> Image.Image:
    """Replace src palette colors with dst (same length)."""
    rgba = im.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    n = min(len(src), len(dst))
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            for i in range(n):
                sr, sg, sb = src[i]
                if abs(r - sr) <= tol and abs(g - sg) <= tol and abs(b - sb) <= tol:
                    dr, dg, db = dst[i]
                    px[x, y] = (dr, dg, db, a)
                    break
    return rgba


def open_rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def layer_path(rel: str, anim: str, color_file: str | None = None) -> Path | None:
    """Resolve LPC layer path: either anim.png or anim/color.png."""
    base = SHEETS / rel
    if color_file:
        p = base / anim / color_file
        if p.exists():
            return p
        p2 = base / f"{anim}.png"
        return p2 if p2.exists() else None
    p = base / f"{anim}.png"
    if p.exists():
        return p
    # some items use anim/ only
    d = base / anim
    if d.is_dir():
        # pick first png if single-color folder unexpected
        pngs = sorted(d.glob("*.png"))
        return pngs[0] if pngs else None
    return None


def lengthen_leg_layer(leg: Image.Image, body: Image.Image, extra: int = 8) -> Image.Image:
    """Stretch pant/sock coverage downward over bare legs before boots are applied."""
    leg = leg.convert("RGBA")
    body = body.convert("RGBA")
    out = leg.copy()
    lp, bp, op = leg.load(), body.load(), out.load()
    w, h = leg.size
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = lp[x, y]
            if a < 180:
                continue
            # found a pant pixel — paint downward over body skin
            for dy in range(1, extra + 1):
                ny = y + dy
                if ny >= h:
                    break
                br, bg, bb, ba = bp[x, ny]
                if ba < 180:
                    break
                # stop if already clothed
                er, eg, eb, ea = op[x, ny]
                if ea > 180:
                    break
                # only cover skin tones
                if not (90 < br < 240 and 60 < bg < 210 and br >= bb):
                    break
                fade = 1 - dy / (extra + 2)
                op[x, ny] = (
                    max(0, int(r * fade)),
                    max(0, int(g * fade)),
                    max(0, int(b * fade)),
                    a,
                )
    return out


def composite_anim(anim: str, *, bald: bool = False) -> Image.Image:
    cloth = load_palette("cloth", "ulpc")
    hair = load_palette("hair", "ulpc")
    body_pal = load_palette("body", "ulpc")

    white = cloth["white"]
    charcoal = cloth["charcoal"]
    boot_dst = cloth.get("leather", cloth["brown"])
    hair_orange = hair["orange"]
    hair_black = hair["black"]
    body_light = body_pal["light"]
    body_olive = body_pal["olive"]

    layers: list[tuple[str, str | None, str, list | None, list | None]] = [
        # rel, color_file, kind, src_pal, dst_pal
        ("body/bodies/male", None, "body", body_light, body_olive),
        ("legs/pantaloons/male", None, "cloth", white, charcoal),
        ("feet/socks/high/male", None, "cloth", white, charcoal),
        ("feet/boots/basic/male", None, "cloth", white, boot_dst),
        ("torso/clothes/sleeveless/sleeveless1/male", None, "cloth", white, white),
        ("eyes/human/adult/default", "brown.png", "none", None, None),
        ("head/heads/human/male", None, "body", body_light, body_olive),
    ]
    if not bald:
        layers.extend(
            [
                ("beards/beard/trimmed", None, "hair", hair_orange, hair_black),
                ("hair/curtains_long/adult", None, "hair", hair_orange, hair_black),
                ("facial/glasses/shades/adult", "black.png", "none", None, None),
            ]
        )

    body_p = layer_path("body/bodies/male", anim)
    if not body_p:
        raise FileNotFoundError(f"missing body anim {anim}")
    body_im = open_rgba(body_p)
    canvas = Image.new("RGBA", body_im.size, (0, 0, 0, 0))
    canvas = Image.alpha_composite(canvas, recolor(body_im, body_light, body_olive))

    # Legs first, stretch coverage, then boots on top
    leg = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    for rel, color_file, kind, src, dst in layers[1:3]:
        p = layer_path(rel, anim, color_file)
        if not p:
            print(f"  skip missing {rel} {anim}")
            continue
        im = open_rgba(p)
        if im.size != canvas.size:
            tmp = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            tmp.alpha_composite(im, (0, 0))
            im = tmp
        if src and dst:
            im = recolor(im, src, dst)
        leg = Image.alpha_composite(leg, im)
    leg = lengthen_leg_layer(leg, canvas, extra=10)
    canvas = Image.alpha_composite(canvas, leg)

    for rel, color_file, kind, src, dst in layers[3:]:
        p = layer_path(rel, anim, color_file)
        if not p:
            if "eyes" in rel:
                continue
            print(f"  skip missing {rel} {anim}")
            continue
        im = open_rgba(p)
        if im.size != canvas.size:
            tmp = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
            tmp.alpha_composite(im, (0, 0))
            im = tmp
        if kind != "none" and src and dst:
            im = recolor(im, src, dst)
        canvas = Image.alpha_composite(canvas, im)

    if not bald:
        darken_shades(canvas)
    return canvas


def build_sheet(*, bald: bool) -> Image.Image:
    label = "bald" if bald else "haired"
    print(f"Composing LPC animations ({label})…")
    anims = {}
    for name in ["idle", "walk", "run", "jump", "sit", "slash", "thrust", "hurt", "halfslash", "emote"]:
        print(f"  {name}")
        anims[name] = composite_anim(name, bald=bald)

    rows: list[list[Image.Image]] = []

    for d in ["up", "down", "right", "left"]:
        idle_f = extract_dir_frames(anims["idle"], d)
        walk_f = extract_dir_frames(anims["walk"], d)
        if len(idle_f) == 2:
            idle_f = [idle_f[0], idle_f[0], idle_f[1], idle_f[0]]
        rows.append(idle_f)
        rows.append(walk_f)

    for d in ["up", "down", "right", "left"]:
        rows.append(extract_dir_frames(anims["run"], d))

    for d in ["up", "down", "right", "left"]:
        rows.append(extract_dir_frames(anims["jump"], d))

    for d in ["up", "down", "right", "left"]:
        sit_f = extract_dir_frames(anims["sit"], d)
        if len(sit_f) >= 2:
            sit_f = [sit_f[0], sit_f[1], sit_f[1]]
        rows.append(sit_f)

    rows.append(extract_all_frames(anims["hurt"]))
    rows.append(make_smoke_frames(anims["idle"]))

    for d in ["up", "down", "right", "left"]:
        punch = extract_dir_frames(anims["halfslash"], d)
        if len(punch) > 4:
            punch = punch[1:]
        rows.append(punch)

    for d in ["up", "down", "right", "left"]:
        idle_f = extract_dir_frames(anims["idle"], d)[0]
        jump_f = extract_dir_frames(anims["jump"], d)
        rows.append(make_kick_frames(idle_f, jump_f, d))

    rows.append(extract_all_frames(anims["hurt"]))
    return pack_rows(rows)


def main() -> None:
    if not SHEETS.exists():
        raise SystemExit(f"LPC spritesheets not found at {SHEETS}")

    OUT.parent.mkdir(parents=True, exist_ok=True)

    sheet = build_sheet(bald=False)
    sheet.save(OUT, optimize=True)
    print(f"Wrote {OUT} ({sheet.size[0]}×{sheet.size[1]})")

    sheet_bald = build_sheet(bald=True)
    sheet_bald.save(OUT_BALD, optimize=True)
    print(f"Wrote {OUT_BALD} ({sheet_bald.size[0]}×{sheet_bald.size[1]})")

    # Preview: idle down frame 0 (haired)
    preview = Image.open(OUT).crop((0, 2 * PF, PF, 3 * PF)).resize((PF * 4, PF * 4), Image.NEAREST)
    preview.save(PREVIEW)
    print(f"Preview {PREVIEW}")

    CREDITS.write_text(
        "Player character sprites composed from Liberated Pixel Cup (LPC) / "
        "Universal LPC Spritesheet Character Generator.\n"
        "License: CC-BY-SA 3.0 / OGA-BY 3.0 / GPL 3.0 (see upstream CREDITS.csv).\n"
        "Authors include (non-exhaustive): bluecarrot16, ElizaWy, JaidynReiman, "
        "Johannes Sjölund (wulax), Stephen Challener (Redshrike), Matthew Krohn (makrohn), "
        "Benjamin K. Smith (BenCreating), and the Liberated Pixel Cup contributors.\n"
        "Source: https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator\n"
        "Custom: left-arm tattoo; smoking (cigarette in mouth) and standing "
        "kick (jump-leg graft) frames added for School Mini.\n"
        "Variants: player.png (hair + shades), player_bald.png (no hair/beard/shades).\n"
    )
    print(f"Credits {CREDITS}")

    # Emit frame map hint
    meta = {
        "frameWidth": PF,
        "frameHeight": PF,
        "cols": COLS,
        "layout": [
            "idleUp", "walkUp", "idleDown", "walkDown",
            "idleRight", "walkRight", "idleLeft", "walkLeft",
            "runUp", "runDown", "runRight", "runLeft",
            "jumpUp", "jumpDown", "jumpRight", "jumpLeft",
            "sitUp", "sitDown", "sitRight", "sitLeft",
            "lie", "smoke",
            "punchUp", "punchDown", "punchRight", "punchLeft",
            "kickUp", "kickDown", "kickRight", "kickLeft",
            "hit",
        ],
    }
    (ROOT / "public" / "assets" / "player_meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print("Wrote player_meta.json")


def darken_shades(sheet: Image.Image) -> None:
    """Force sunglass lenses to solid dark (kính dâm)."""
    px = sheet.load()
    w, h = sheet.size
    cols, rows = w // FRAME, h // FRAME
    for row in range(rows):
        for col in range(cols):
            ox, oy = col * FRAME, row * FRAME
            for y in range(oy + 14, oy + 32):
                for x in range(ox + 22, ox + 42):
                    if x >= w or y >= h:
                        continue
                    r, g, b, a = px[x, y]
                    if a < 120:
                        continue
                    if r > 180 and g > 170:  # tank
                        continue
                    if r > 140 and g > 80 and r > g + 20:  # skin
                        continue
                    if r < 170 and g < 175 and b < 170:
                        px[x, y] = (4, 5, 6, 255)


def add_tattoo(sheet: Image.Image, anim: str) -> None:
    """Stamp a bold ink sleeve on exposed arm skin (never on head/face)."""
    _ = anim
    w, h = sheet.size
    cols = w // FRAME
    rows = h // FRAME
    px = sheet.load()

    # Arms only — y starts below the jaw so bald heads keep clean cheeks
    regions_by_dir = {
        "down": [(38, 36, 48, 48), (16, 36, 26, 48)],
        "up": [(16, 36, 26, 48), (38, 36, 48, 48)],
        "right": [(24, 36, 34, 50)],
        "left": [(30, 36, 44, 50)],
    }

    def is_skin(r, g, b, a):
        if a < 160:
            return False
        if r > 200 and g > 190:
            return False
        if r < 50 and g < 40:
            return False
        return 90 <= r <= 230 and 50 <= g <= 200 and r >= g - 5 and r > b

    for dname, row in DIR.items():
        if row >= rows:
            continue
        for x0, y0, x1, y1 in regions_by_dir[dname]:
            for c in range(cols):
                ox, oy = c * FRAME, row * FRAME
                for y in range(oy + y0, oy + y1):
                    for x in range(ox + x0, ox + x1):
                        if x >= w or y >= h:
                            continue
                        # Hard exclude head/face band
                        if (y - oy) < 36:
                            continue
                        r, g, b, a = px[x, y]
                        if not is_skin(r, g, b, a):
                            continue
                        lx, ly = x - (ox + x0), y - (oy + y0)
                        if (lx + ly) % 2 == 0 or lx % 3 == 0 or ly % 4 == 0:
                            px[x, y] = (10, 18, 40, 255)
                        else:
                            px[x, y] = (18, 28, 52, 255)


def extract_dir_frames(sheet: Image.Image, direction: str) -> list[Image.Image]:
    rows = sheet.size[1] // FRAME
    row = 0 if rows <= 1 else DIR[direction]
    cols = sheet.size[0] // FRAME
    frames = []
    for c in range(cols):
        fr = sheet.crop((c * FRAME, row * FRAME, (c + 1) * FRAME, (row + 1) * FRAME))
        if UPSCALE != 1:
            fr = fr.resize((PF, PF), Image.NEAREST)
        frames.append(fr)
    return frames


def extract_all_frames(sheet: Image.Image) -> list[Image.Image]:
    """Flatten single-row sheets (e.g. hurt)."""
    return extract_dir_frames(sheet, "down")


def blank() -> Image.Image:
    return Image.new("RGBA", (PF, PF), (0, 0, 0, 0))


def _sample_color(
    im: Image.Image,
    box: tuple[int, int, int, int],
    pred,
    default: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    px = im.load()
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = px[x, y]
            if a > 200 and pred(r, g, b):
                return (r, g, b, a)
    return default


def _brush(im: Image.Image, x: float, y: float, color: tuple[int, int, int, int], rad: float) -> None:
    px = im.load()
    r = max(1, int(round(rad)))
    cx, cy = int(round(x)), int(round(y))
    rr = r * r
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy <= rr + 0.8:
                xx, yy = cx + dx, cy + dy
                if 0 <= xx < PF and 0 <= yy < PF:
                    px[xx, yy] = color


def _stroke(
    im: Image.Image,
    x0: float,
    y0: float,
    x1: float,
    y1: float,
    color: tuple[int, int, int, int],
    width: float,
) -> None:
    steps = max(int(math.hypot(x1 - x0, y1 - y0) * 3), 1)
    for i in range(steps + 1):
        t = i / steps
        _brush(im, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, color, width / 2)


def _is_leg_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a < 160:
        return False
    if r > 195 and g > 190:
        return False
    skin = 90 < r < 230 and 50 < g < 200 and r >= g - 5 and r > b
    pants = r < 100 and g < 105 and b < 120
    boot = r > 80 and g > 40 and b < 105 and r > b + 15 and g < 150
    return skin or pants or boot


def _is_arm_pixel(r: int, g: int, b: int, a: int) -> bool:
    if a < 160:
        return False
    if r > 195 and g > 190:
        return False
    skin = 90 < r < 230 and 50 < g < 200 and r >= g - 5 and r > b
    ink = r < 55 and g < 55 and b < 95
    return skin or ink


def _extract_leg(im: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    out = Image.new("RGBA", (PF, PF), (0, 0, 0, 0))
    px, op = im.load(), out.load()
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = px[x, y]
            if _is_leg_pixel(r, g, b, a):
                op[x, y] = (r, g, b, a)
    return out


def _clear_leg(im: Image.Image, box: tuple[int, int, int, int]) -> None:
    px = im.load()
    x0, y0, x1, y1 = box
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b, a = px[x, y]
            if _is_leg_pixel(r, g, b, a):
                px[x, y] = (0, 0, 0, 0)


def _rotate_around(im: Image.Image, pivot: tuple[int, int], angle_deg: float) -> Image.Image:
    px, py = pivot
    ang = math.radians(angle_deg)
    cos_a, sin_a = math.cos(ang), math.sin(ang)
    dest = Image.new("RGBA", (PF, PF), (0, 0, 0, 0))
    sp, dp = im.load(), dest.load()
    for y in range(PF):
        for x in range(PF):
            dx, dy = x - px, y - py
            sx = cos_a * dx + sin_a * dy + px
            sy = -sin_a * dx + cos_a * dy + py
            ix, iy = int(round(sx)), int(round(sy))
            if 0 <= ix < PF and 0 <= iy < PF:
                p = sp[ix, iy]
                if p[3] > 0:
                    dp[x, y] = p
    return dest


def _shift_im(im: Image.Image, sx: int, sy: int) -> Image.Image:
    if not sx and not sy:
        return im
    out = Image.new("RGBA", (PF, PF), (0, 0, 0, 0))
    out.paste(im, (sx, sy))
    return out


def make_smoke_frames(idle_sheet: Image.Image) -> list[Image.Image]:
    """Standing smoke (down): cigarette at lips + rising puffs. Prefer runtime overlay."""
    idle_f = extract_dir_frames(idle_sheet, "down")
    base = idle_f[0] if idle_f else blank()
    # lips / beard line — below nose (was 27–29, too high)
    mouth = (31, 31)
    out: list[Image.Image] = []

    for i in range(10):
        fr = base.copy()
        mx, my = mouth
        for dx, col in [
            (0, (200, 170, 120)),
            (1, (235, 220, 185)),
            (2, (235, 220, 185)),
            (3, (235, 220, 185)),
            (4, (230, 210, 170)),
            (5, (220, 65, 28)),
            (6, (255, 140, 45)),
        ]:
            fr.putpixel((mx + dx, my), (*col, 255))
            if dx < 5:
                fr.putpixel(
                    (mx + dx, my + 1),
                    (max(0, col[0] - 25), max(0, col[1] - 25), max(0, col[2] - 20), 255),
                )
        fr.putpixel((mx + 6, my - 1), (255, 160, 50, 255))

        d = ImageDraw.Draw(fr)
        for p in range(3):
            phase = (i + p * 2) % 10
            sx = mx + 6 + (p % 2) - phase // 5
            sy = my - 2 - phase
            if sy < 10:
                continue
            rad = 1 if phase < 5 else 2
            gray = 190 + p * 8
            d.ellipse([sx - rad, sy - rad, sx + rad, sy + rad], fill=(gray, gray, gray, 255))
        out.append(fr)
    return out


_LEG_BOX = {
    "down": (14, 36, 32, 63),
    "up": (32, 36, 50, 63),
    "right": (30, 35, 52, 63),
    "left": (12, 35, 34, 63),
}
_HIP = {"down": (24, 38), "up": (40, 38), "right": (34, 40), "left": (30, 40)}


def make_kick_frames(
    idle: Image.Image,
    jumps: list[Image.Image],
    direction: str,
) -> list[Image.Image]:
    """Standing teep: idle plant + jump high-knee chamber + drawn peak extension."""
    box = _LEG_BOX[direction]
    hip = _HIP[direction]
    j2 = jumps[min(2, len(jumps) - 1)] if jumps else idle
    j3 = jumps[min(3, len(jumps) - 1)] if jumps else idle
    pants = _sample_color(
        idle, (24, 40, 40, 50), lambda r, g, b: r < 100 and g < 105, (45, 45, 52, 255)
    )
    pants_d = (max(0, pants[0] - 18), max(0, pants[1] - 18), max(0, pants[2] - 14), 255)
    boot = _sample_color(
        idle,
        (18, 52, 46, 62),
        lambda r, g, b: r > 80 and g > 40 and b < 100 and r > b + 15,
        (120, 78, 48, 255),
    )
    boot_d = (max(0, boot[0] - 28), max(0, boot[1] - 22), max(0, boot[2] - 12), 255)

    def graft(src: Image.Image, ang: float = 0, sh: tuple[int, int] = (0, 0)) -> Image.Image:
        fr = idle.copy()
        _clear_leg(fr, box)
        limb = _extract_leg(src, box)
        if ang:
            limb = _rotate_around(limb, hip, ang)
        if sh != (0, 0):
            limb = _shift_im(limb, *sh)
        fr = Image.alpha_composite(fr, limb)
        _brush(fr, hip[0], hip[1], pants, 2.5)
        return fr

    def draw_peak(knee: tuple[int, int], foot: tuple[int, int]) -> Image.Image:
        """Paint a connected teep on top of idle (plant foot stays)."""
        fr = idle.copy()
        # erase only the old kicking foot on the ground so it doesn't double
        if direction == "right":
            _clear_leg(fr, (34, 50, 48, 63))
        elif direction == "left":
            _clear_leg(fr, (16, 50, 30, 63))
        elif direction == "down":
            _clear_leg(fr, box)
        else:
            _clear_leg(fr, box)
        # thigh
        _stroke(fr, hip[0], hip[1], knee[0], knee[1], pants, 5.8)
        _stroke(fr, hip[0], hip[1], knee[0], knee[1], pants_d, 3.2)
        _brush(fr, knee[0], knee[1], pants, 2.8)
        # shin
        _stroke(fr, knee[0], knee[1], foot[0], foot[1], pants, 4.6)
        _stroke(fr, knee[0], knee[1], foot[0], foot[1], pants_d, 2.4)
        # boot
        _brush(fr, foot[0], foot[1], boot, 3.4)
        _brush(fr, foot[0], foot[1] + 1, boot_d, 2.6)
        if direction == "right":
            _brush(fr, foot[0] + 2, foot[1], boot, 2.6)
            _brush(fr, foot[0] + 3, foot[1] + 1, boot_d, 2.0)
        elif direction == "left":
            _brush(fr, foot[0] - 2, foot[1], boot, 2.6)
            _brush(fr, foot[0] - 3, foot[1] + 1, boot_d, 2.0)
        else:
            _brush(fr, foot[0], foot[1] + 2, boot_d, 2.8)
        _brush(fr, hip[0], hip[1], pants, 2.8)
        return fr

    peaks = {
        "right": ((43, 41), (55, 43)),
        "left": ((21, 41), (9, 43)),
        "down": ((25, 45), (27, 58)),
        "up": ((39, 45), (37, 58)),
    }
    knee, foot = peaks[direction]
    chamber = graft(j2)
    high = graft(j3, 0, (0, -1) if direction in ("right", "left") else (0, 0))
    peak = draw_peak(knee, foot)
    wind = draw_peak(
        ((knee[0] + hip[0]) // 2, (knee[1] + hip[1]) // 2 - 2),
        ((foot[0] + knee[0]) // 2, (foot[1] + knee[1]) // 2 - 2),
    )

    return [
        idle.copy(),
        chamber,
        high,
        wind,
        peak,
        peak.copy(),
        wind,
        chamber,
        idle.copy(),
    ]


def pack_rows(rows: list[list[Image.Image]]) -> Image.Image:
    h = len(rows) * PF
    w = COLS * PF
    sheet = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    for r, frames in enumerate(rows):
        for c, fr in enumerate(frames[:COLS]):
            sheet.alpha_composite(fr, (c * PF, r * PF))
    return sheet


if __name__ == "__main__":
    main()
