"""Screenshots of the local viewer (file://) with Playwright, one per area, plus a tapped rock.

    python -I shoot_viewer.py /Volumes/workdrive/rocks-pilot/viewer.html <out-dir>
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

viewer, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 950})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    for area in ("down", "dublin"):
        page.goto(f"{viewer.as_uri()}?area={area}")
        page.wait_for_timeout(6000)  # imagery tiles
        page.screenshot(path=str(out / f"viewer-{area}.png"))
        n = page.evaluate("document.querySelectorAll('path.leaflet-interactive').length")
        print(area, "vector paths drawn:", n)
    # Heights overlay on, Dublin difference map on, then a tapped rock.
    page.goto(f"{viewer.as_uri()}?area=dublin")
    page.wait_for_timeout(3000)
    for label in ("Dublin: Satellite minus foil-depth layer",):
        page.get_by_text(label, exact=False).click()
    page.wait_for_timeout(3000)
    page.screenshot(path=str(out / "viewer-dublin-diff.png"))
    page.goto(f"{viewer.as_uri()}?area=down")
    page.wait_for_timeout(3000)
    page.get_by_text("Co. Down: Intertidal height", exact=False).click()
    page.wait_for_timeout(3000)
    page.screenshot(path=str(out / "viewer-down-heights.png"))
    page.evaluate("""() => { const g = Object.values(map._layers).find(l => l.feature && l.feature.properties && l.feature.properties.confidenceClass === 'high');
                             if (g) { map.fitBounds(g.getBounds(), {maxZoom: 16}); g.openPopup(); } }""")
    page.wait_for_timeout(5000)
    page.screenshot(path=str(out / "viewer-down-popup.png"))
    browser.close()
    print("console errors:", errors[:10])
