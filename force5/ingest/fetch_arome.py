"""Publish Météo-France AROME 0.025° wind and gusts at native 2.5 km resolution.

Etalab Open Licence 2.0, no API key. AROME runs every three hours to +51 h. Its
published EURW1S40 grid is only the bounding box of a rotated native domain: a
GRIB2 bitmap masks about 17% of it, and the masked north-west corner cuts
diagonally across Ireland, so the model's real edge over Donegal is nothing like
a line of latitude. On the 55°N row valid data begins at 8.45°W, and the whole
55.4°N row is masked.

The crop is therefore the largest rectangle wholly inside the unmasked area:
10.9°W–5°W, 51–54.75°N, at the native 0.025°. That covers Ireland's west, south
and east coasts and Belfast Lough, and leaves out the three riding locations
AROME genuinely cannot resolve — Pollan Bay, Benone Strand and Magheraroarty.
Those keep their place in `spotForecasts` with null values and are named in the
manifest's `coverageNote`; ARPEGE is the fallback for them.

The whole 0.025° surface package is 461 MB a run with no server-side subsetting,
so `meteofrance.py` walks its GRIB2 headers over byte ranges and fetches only
the 10 m u/v and FF_RAF messages. Gusts are the maximum over the hour ending at
each forecast time; initialization has no preceding hour.
"""
import argparse
import sys

import meteofrance
import timing

SPEC = meteofrance.SPECS["arome"]
PROSE = {
    "processing": (
        "Published at the native 0.025° AROME resolution with no resampling: the source is "
        "already a regular latitude/longitude grid, so the crop is a straight cell selection. "
        "Source 0–360° longitudes are normalised to −180…180° and the crop is taken on integer "
        "lattice indices, because 0.025° is not a binary fraction and a float comparison loses "
        "a boundary column. The published box is 10.9°W–5°W, 51–54.75°N at 237 × 151 cells — "
        "the largest rectangle that fits inside the model's masked native domain, not a "
        "preference. Rows run north-to-south and columns west-to-east. Vectors are "
        "earth-relative in the source, so no rotation is applied. Values are model output in "
        "m/s rounded to 0.01. Only native AROME steps are published: no hours are interpolated "
        "or invented, and no masked cell is ever published as a number."),
    "gustDescription": (
        "Maximum 10 m gust over the one hour ending at each forecast time (Météo-France "
        "FF_RAF), read from the GRIB2 statistical process — maximum, one-hour time range — "
        "and not from the parameter number alone. The window stays one hour even when the "
        "published cadence is three-hourly, so a three-hourly frame describes the last hour "
        "before it and not the whole gap. Initialization (+0h) has no preceding hour and is "
        "published as unavailable, not zero. These interval maxima read higher than the "
        "instantaneous gusts GFS and GEFS publish; do not compare them directly."),
    "coverageNote": (
        "AROME's 0.025° grid is published as a latitude/longitude box, but the model itself "
        "covers a rotated domain inside it and the rest is masked. The masked corner cuts "
        "diagonally across Donegal: on the 55°N row the model starts only at 8.45°W, and the "
        "55.4°N row is masked outright. This crop, 10.9°W–5°W and 51–54.75°N, is the largest "
        "rectangle wholly inside the model, so it covers the west, south and east coasts and "
        "Belfast Lough but stops short of the north coast. Use ARPEGE or HARMONIE north of it; "
        "AROME has nothing to say there."),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hours", type=int, default=SPEC["horizon"],
                        help=f"3–{SPEC['horizon']}, divisible by --step; default {SPEC['horizon']}")
    parser.add_argument("--step", type=int, choices=[1, 3], default=3)
    parser.add_argument("--run", help="Optional specific YYYYMMDDHH run (every third hour)")
    parser.add_argument("--source", choices=["s3", "datagouv"], default="s3",
                        help="Discover runs from the OVH bucket listing, or from the "
                             "data.gouv.fr resource catalogue. Both download from the bucket.")
    parser.add_argument("--workers", type=int, default=3, choices=[1, 2, 3, 4],
                        help="Package files walked and downloaded at once")
    return meteofrance.refresh(SPEC, parser.parse_args(), PROSE)


if __name__ == "__main__":
    try:
        # A run that is already published exits UNCHANGED_EXIT, which the worker
        # reads as "nothing new", not as a failure and not as a bundle to validate.
        sys.exit(main() or 0)
    except Exception as error:
        print(f"AROME refresh failed: {error}. Last published snapshot preserved.", file=sys.stderr)
        sys.exit(1)
    finally:
        timing.finish()
