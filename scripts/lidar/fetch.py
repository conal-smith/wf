"""Fetch INFOMAR's bathymetric LiDAR surveys for the LiDAR layer.

The 2008 airborne bathymetric LiDAR of Lough Foyle and of Tralee and Brandon
Bays (Geological Survey Ireland & Marine Institute, CC BY 4.0): 5 m GeoTIFFs,
heights above LAT, positive up. Each zip goes under <data>/infomar-lidar/zips/
and its GeoTIFF beside it as <name>.tif; what is on disk is not read again.

    python -I fetch.py --data /Volumes/workdrive/lidar/data

The other sources are the foil layer's downloads (README.md): GSI's LiDAR
tiles from scripts/foildepth/fetch_pilots.py, OSNI's flights from
scripts/foildepth/fetch_national.py osni-lidar.
"""
import argparse
import os
import shutil
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "foildepth"))
from fetch_national import GSI_DOWNLOADS, get, write_atomic  # noqa: E402

SURVEYS = [
    ("lidar-2008-lough-foyle-5m", "2008/Li_08/BY_LiDAR_2008_LoughFoyle_5m_U29N_LAT_TIFF_Inshore_Ireland.zip"),
    ("lidar-2008-tralee-bay-5m", "2008/Li_08/BY_LiDAR_2008_TraleeBay_5m_U29N_LAT_TIFF_Inshore_Ireland.zip"),
]


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--data", required=True)
    a = p.parse_args()
    d = os.path.join(a.data, "infomar-lidar")
    for name, path in SURVEYS:
        out = os.path.join(d, name + ".tif")
        if os.path.exists(out):
            continue
        z = os.path.join(d, "zips", name + ".zip")
        if not os.path.exists(z):
            write_atomic(z, get(GSI_DOWNLOADS + path, timeout=1800))
        with zipfile.ZipFile(z) as zf:
            # The archive's one GeoTIFF, by its name's ending only: no path from it is used.
            member = next(n for n in zf.namelist() if n.lower().endswith(".tif"))
            with zf.open(member) as src, open(out + ".part", "wb") as dst:
                shutil.copyfileobj(src, dst)
        os.replace(out + ".part", out)
        print(f"{name}: {os.path.getsize(out) / 1e6:.1f} MB")


if __name__ == "__main__":
    sys.exit(main())
