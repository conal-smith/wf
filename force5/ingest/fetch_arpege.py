"""Publish Météo-France ARPEGE 0.1° wind and gusts for the Ireland/Atlantic box.

Etalab Open Licence 2.0, no API key. ARPEGE runs four times a day and its 0.1°
EURAT01 surface package is hourly all the way to +102 h, which is further than
the 48-hour hourly limit the upper-air packages have. The whole package is
646 MB a run with no server-side subsetting, so `meteofrance.py` walks its GRIB2
headers over byte ranges and fetches only the 10 m u/v and FF_RAF messages.

Gusts are FF_RAF: the maximum over the hour ending at each forecast time, taken
from the GRIB statistical keys. Initialization has no preceding hour and is
published as unavailable, not zero.
"""
import argparse
import sys

import meteofrance

SPEC = meteofrance.SPECS["arpege"]
PROSE = {
    "processing": (
        "Cropped from Météo-France's 0.1° EURAT01 regular latitude/longitude grid without "
        "downscaling; source 0–360° longitudes are normalised to −180…180° and the crop is "
        "taken on integer lattice indices, because 0.1° is not a binary fraction and a "
        "float comparison loses a boundary column. The published box is 18°W–2°E, 48–59°N, "
        "the same one ECMWF, GFS and ICON-EU use, at 201 × 111 cells. Rows run "
        "north-to-south and columns west-to-east. Vectors are earth-relative in the source, "
        "so no rotation is applied. Values are model output in m/s rounded to 0.01. Only "
        "native ARPEGE steps are published: no hours are interpolated or invented."),
    "gustDescription": (
        "Maximum 10 m gust over the one hour ending at each forecast time (Météo-France "
        "FF_RAF), read from the GRIB2 statistical process — maximum, one-hour time range — "
        "and not from the parameter number alone. The window stays one hour even when the "
        "published cadence is three-hourly, so a three-hourly frame describes the last hour "
        "before it and not the whole gap. Initialization (+0h) has no preceding hour and is "
        "published as unavailable, not zero. These interval maxima read higher than the "
        "instantaneous gusts GFS and GEFS publish; do not compare them directly."),
    "coverageNote": (
        "The ARPEGE EURAT01 domain runs 32°W–42°E and 20–72°N, so the whole published "
        "Ireland/Atlantic box sits inside it with a wide margin and every riding location "
        "has a full series."),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=SPEC["horizon"],
                        help=f"3–{SPEC['horizon']}, divisible by --step; default {SPEC['horizon']}")
    parser.add_argument("--step", type=int, choices=[1, 3], default=3)
    parser.add_argument("--run", help="Optional specific YYYYMMDDHH run (00/06/12/18)")
    parser.add_argument("--source", choices=["s3", "datagouv"], default="s3",
                        help="Discover runs from the OVH bucket listing, or from the "
                             "data.gouv.fr resource catalogue. Both download from the bucket.")
    parser.add_argument("--workers", type=int, default=3, choices=[1, 2, 3, 4],
                        help="Package files walked and downloaded at once")
    meteofrance.refresh(SPEC, parser.parse_args(), PROSE)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ARPEGE refresh failed: {error}. Last published snapshot preserved.", file=sys.stderr)
        sys.exit(1)
