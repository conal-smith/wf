"""Copy the pilot's small results into scripts/rockspilot/findings/ (JSON, rock GeoJSON, reduced images).

    python -I collect_findings.py <out> <screenshots-dir>
"""
import shutil
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
out, shots = Path(sys.argv[1]), Path(sys.argv[2])
dest = HERE / "findings"
dest.mkdir(exist_ok=True)
files = ["tide/tide-calibration.json", "tide-consistency.json",
         "down/down-heights.json", "down/down-rocks-vs-osm.json", "down/down-rocks.geojson",
         "dublin/dublin-heights.json", "dublin/dublin-rocks-vs-osm.json", "dublin/dublin-rocks.geojson",
         "dublin/dublin-vs-foildepth.json", "dublin/dublin-sensitivity-vs-foildepth.json", "dublin/dublin-layer-vs-scenes.json",
         "portmarnock/portmarnock-heights.json", "portmarnock/portmarnock-vs-foildepth.json",
         "portmarnock/portmarnock-sensitivity-vs-lidar.json", "portmarnock/portmarnock-layer-vs-scenes.json"]
for f in files:
    shutil.copy(out / f, dest / Path(f).name)
images = ["down/down-lowtide-rgb.png", "down/down-hightide-rgb.png", "down/down-rocks-overlay.png", "down/down-osm-overlay.png",
          "down/down-heights.png", "dublin/dublin-lowtide-rgb.png", "dublin/dublin-hightide-rgb.png",
          "dublin/dublin-rocks-overlay.png", "dublin/dublin-osm-overlay.png", "dublin/dublin-heights.png",
          "dublin/dublin-heights-vs-foildepth.png", "dublin/dublin-heights-scatter.png",
          "portmarnock/portmarnock-heights-vs-foildepth.png", "portmarnock/portmarnock-heights-scatter.png"]
for f in images:
    im = Image.open(out / f).convert("RGB")
    im.thumbnail((1000, 1000))
    im.save(dest / (Path(f).stem + ".jpg"), quality=78, optimize=True)
for f in ["viewer-down.png", "viewer-dublin-diff.png", "viewer-down-popup.png"]:
    im = Image.open(shots / f).convert("RGB")
    im.thumbnail((1100, 1100))
    im.save(dest / (Path(f).stem + ".jpg"), quality=78, optimize=True)
total = sum(p.stat().st_size for p in dest.iterdir())
print(f"{len(list(dest.iterdir()))} files, {total / 1e6:.1f} MB in {dest}")
