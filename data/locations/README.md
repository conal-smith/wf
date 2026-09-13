# Irish wind-sport coordinates

Collected 13 September 2026. **46 sourced research records across 14 counties**, including Northern Ireland. `src/locations.ts` merges these with the eight original forecast spots, deduplicating Keel and Inchydoney into 52 research entries. Its public filter shows **25 riding-place references**, not a business directory. Original forecast IDs and coordinates are preserved; new locations sample the forecast grids on demand.

Open [the CSV](irish-wind-sport-locations.csv) in a spreadsheet to see every name, county, latitude, longitude, classification and source link.

## Files

- [failte-ireland.json](failte-ireland.json): 37 records downloaded from Fáilte Ireland's public CSV, selected by windsurf/kitesurf/wingfoil tags. CC BY 4.0, with attribution and the downloaded source's SHA-256. No telephone numbers, images or contact details retained. The source has no record-ID column; our IDs are local slugs.
- [openstreetmap.json](openstreetmap.json): Blast at Kilcrea and Newtownards Sailing Club. Kept separately with ODbL attribution and original OSM identifiers. Blast's node was retrieved directly from the OSM API; Newtownards uses Mapcarta's displayed OSM-derived position, with sports corroborated by the club's website.
- [web-research.json](web-research.json): seven records transcribed from individual public pages, with source URLs. Includes four Mayo guide references, Ballyholme's slipway-project coordinate, Benone and Magheraroarty. Names and coordinates only; no copied guide descriptions or photos. Do not assume a blanket open licence for these sources.
- [irish-wind-sport-locations.csv](irish-wind-sport-locations.csv): combined convenience index of those three files. Source-specific licensing still applies; the CSV does not relicense the source records.

## What the pins mean

The raw research contains **17 spot references, 23 operator locations, two clubs and four broad area references**. Operator, club and broad area listings are excluded from the public map. Two explicitly curated place references, Kilcrea and Newtownards, retain their operator/club-derived coordinates with clear access caveats, not business promotion. `source-located` means a coordinate was found in the cited source; it does not mean a launch was surveyed, public access checked, or wingfoiling suitability confirmed. `launchVerified` is false for every collected record.

Fáilte Ireland sport tags are retained as provider claims, not independent confirmation that every business currently teaches both sports. A windsurfing or kitesurfing entry is not automatically labelled wingfoiling.

Coordinates use WGS84 decimal degrees: latitude first, negative longitude west. Source precision is preserved without claiming equivalent physical accuracy. Some points identify an operator, a forecast reference or a guide's map viewport rather than the water entry point.

## Specific checks and exclusions

- Blast: **53.4690824, -6.1755492**, OSM node `10816824305`, on Kilcrea Road. Search aliases include Donabate, Malahide Estuary and Broadmeadows. This is the operator's pin, not a separately established north-shore launch.
- Newtownards and Ballyholme coordinates are club-related locations, not a grant of access.
- Keel and Inchydoney are merged with the original spots while preserving their forecast IDs. Nearby operator pins such as Rusheen Bay Watersports remain research-only, not additional public map points.
- The Mayo Mayhem guide gives one map centre for Carrownisky/Silver Strand and repeats a broad map link for Falmore/Blacksod. Those ambiguous references were **not** turned into separate precise pins.
- The four Fáilte Ireland island/area records are retained for transparency, but should not be displayed as specific launches.

## Sources

- [Fáilte Ireland CSV and CC BY 4.0 metadata](https://data.gov.ie/ga/dataset/tourism-activities-and-attractions/resource/7a6245fd-d07a-4b2f-82a7-19373eb648b6)
- [Mayo Mayhem location guide](https://mayomayhem.ie/posts/location-guide)
- [Blast OSM node](https://www.openstreetmap.org/node/10816824305)
- [Newtownards winging and foiling](https://www.newtownardssailingclub.co.uk/winging-and-foiling.html)
- [Ballyholme slipway coordinates, DAERA](https://www.daera-ni.gov.uk/publications/marine-licence-ml-619-ballyholme-yacht-club-slipway-repair)

The public map uses spot circles only, with no business website buttons. Search includes Blast's aliases to find Kilcrea, but the display name is “Kilcrea — Malahide Estuary”. Spot popouts provide coordinates, notes and source links; dataset attribution remains in the information dialog. These references are not verified launches. Paid business listings would be a separate future feature; no billing or sponsored layer is implemented.
