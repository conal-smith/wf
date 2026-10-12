"""EMODnet Geology seabed substrate (GTK WFS, CC BY 4.0) over the pilot areas.

    python -I fetch_substrate.py <out-dir>
"""
import collections
import json
import sys
from pathlib import Path
from urllib.parse import urlencode

import requests

HERE = Path(__file__).resolve().parent
WFS = "https://drive.emodnet-geology.eu/geoserver/gtk/wfs"
LAYERS = ["seabed_substrate_10k_multiscale", "seabed_substrate_100k", "seabed_substrate_250k"]


def main(out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    areas = json.loads((HERE / "areas.json").read_text())["areas"]
    for area_id, area in areas.items():
        w, s, e, n = area["bbox"]
        for layer in LAYERS:
            query = {"service": "WFS", "version": "2.0.0", "request": "GetFeature",
                     "typeNames": f"gtk:{layer}", "outputFormat": "application/json",
                     "srsName": "EPSG:4326", "bbox": f"{s},{w},{n},{e},EPSG:4326"}
            response = requests.get(f"{WFS}?{urlencode(query)}", timeout=180)
            path = out / f"emodnet_{layer}_{area_id}.json"
            path.write_bytes(response.content)
            try:
                features = json.loads(response.content)["features"]
            except Exception:
                print(area_id, layer, "not JSON:", response.text[:200])
                continue
            classes = collections.Counter()
            for f in features:
                p = f["properties"]
                classes[p.get("folk_5cl_txt") or p.get("folk_7cl_txt") or p.get("folk_16cl_txt") or
                        str({k: v for k, v in p.items() if "folk" in k.lower()})] += 1
            print(area_id, layer, len(features), classes.most_common(6))
            if features:
                print("   keys:", list(features[0]["properties"])[:20])


if __name__ == "__main__":
    main(sys.argv[1])
