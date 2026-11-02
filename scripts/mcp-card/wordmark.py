"""
The wordmark as outlines, for the AI apps' spot card (mcp/app/spotCard.ts),
which carries no fonts: "wingfoil" in Fraunces semibold and ".ie" in its
medium italic, both at the 72 pt optical size, set a quarter of a percent of
an em tight, as ui/Wordmark.tsx sets them. Cut from the same variable fonts
the site ships (@fontsource-variable/fraunces), into mcp/app/wordmark.ts.

Run again only if the wordmark changes:

    python3 -m venv /tmp/ft && /tmp/ft/bin/pip install fonttools brotli
    /tmp/ft/bin/python scripts/mcp-card/wordmark.py
"""
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

REPO = Path(__file__).resolve().parents[2]
FONTS = REPO / "node_modules/@fontsource-variable/fraunces/files"
OUT = REPO / "mcp/app/wordmark.ts"
TRACK = -0.025  # tracking-tight


def instance(file: str, weight: int) -> TTFont:
    font = TTFont(FONTS / file)
    at = {a.axisTag: a.defaultValue for a in font["fvar"].axes}
    at.update(wght=weight, opsz=72)
    return instantiateVariableFont(font, at)


def outline(font: TTFont, text: str, x: float) -> tuple[str, float]:
    em = font["head"].unitsPerEm
    cmap, glyphs, metrics = font.getBestCmap(), font.getGlyphSet(), font["hmtx"]
    paths = []
    for ch in text:
        name = cmap[ord(ch)]
        pen = SVGPathPen(glyphs, ntos=lambda n: f"{round(n)}")
        glyphs[name].draw(TransformPen(pen, (1, 0, 0, -1, round(x), 0)))
        paths.append(pen.getCommands())
        x += metrics[name][0] + TRACK * em
    return "".join(paths), x


roman = instance("fraunces-latin-opsz-normal.woff2", 600)
italic = instance("fraunces-latin-opsz-italic.woff2", 500)
name, x = outline(roman, "wingfoil", 0)
domain, end = outline(italic, ".ie", x)
ascent, descent = roman["hhea"].ascent, roman["hhea"].descent

OUT.write_text(
    f"""/**
 * The wordmark as outlines, written by scripts/mcp-card/wordmark.py from the
 * site's own Fraunces: "wingfoil" semibold, ".ie" medium italic, at the 72 pt
 * optical size and set tight, as ui/Wordmark.tsx sets them. For the AI apps'
 * spot card, which carries no fonts. Do not edit; run the script again.
 */
export const WORDMARK = {{
  viewBox: "0 {-ascent} {round(end - TRACK * roman["head"].unitsPerEm)} {ascent - descent}",
  name: "{name}",
  domain: "{domain}",
}};
"""
)
print(f"{OUT.relative_to(REPO)}: {len(name) + len(domain)} characters of path")
