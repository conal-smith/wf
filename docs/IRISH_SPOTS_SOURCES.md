# Irish wind-sport spot sources

Research date: 13 September 2026. **Collection update:** 46 sourced coordinate records have been saved in [data/locations](../data/locations/README.md), including a spreadsheet-ready CSV. Fáilte Ireland data has been downloaded and filtered; individual web/OSM locations have been recorded. These merge with the original eight spots into 52 research entries, preserving provenance. The public map/search is filtered to 25 riding-place references, not business listings or broad areas. Kilcrea and Newtownards use place names with explicit coordinate/access caveats. No third-party contact has been performed. The records are not verified or assessed as safe launches.

## Best starting point: Fáilte Ireland open data

The [Tourism Activities and Attractions dataset](https://data.gov.ie/dataset/tourism-activities-and-attractions/resource/7a6245fd-d07a-4b2f-82a7-19373eb648b6) provides names, counties, coordinates, categories and websites under CC BY 4.0. [Download its CSV](https://failteireland.azure-api.net/opendata-api/v2/attractions/csv).

The research pass found 37 windsurfing/kitesurfing-tagged records among 6,235 records. These mix beaches, schools and businesses: do not present all 37 as launch sites or imply suitability for wingfoiling. Source counts may change.

Examples for manual review:

| Record                        | County    | Latitude   | Longitude   | Classification to verify |
| ----------------------------- | --------- | ---------- | ----------- | ------------------------ |
| Maharees Beach                | Kerry     | 52.2892473 | -10.0312646 | Beach                    |
| Inchydoney East Beach         | Cork      | 51.5965838 | -8.8659338  | Beach                    |
| Lahinch Beach                 | Clare     | 52.9336105 | -9.34783    | Beach                    |
| Pollan Bay                    | Donegal   | 55.2999126 | -7.379951   | Beach                    |
| Blackrock Beach               | Louth     | 53.9611771 | -6.3666434  | Beach                    |
| Rusheen Bay Watersports       | Galway    | 53.2585164 | -9.1194506  | Operator                 |
| Jamie Knox Watersports        | Kerry     | 52.2996194 | -10.0295375 | Operator                 |
| Dunmore East Adventure Centre | Waterford | 52.1488428 | -6.9929775  | Operator                 |

Retain attribution and the source URL in the imported records. Coverage needs supplementation for Northern Ireland and less commercial spots.

## Blast, Kilcrea / Malahide Estuary

[Blast's official website](https://blastwatersportsdublin.com/) and the [GWA schools directory](https://www.globalwingsportsassociation.org/wingfoil-schools/) identify its watersports operation. [OpenStreetMap node 10816824305](https://www.openstreetmap.org/node/10816824305) places it at **53.4690824, -6.1755492**.

Treat this as an operator-location candidate, not a surveyed launch, access point or safety assessment. Confirm the actual launch with the operator before labelling it as one. OSM data has separate [ODbL attribution and database obligations](https://www.openstreetmap.org/copyright); keep provenance explicit rather than silently merging datasets.

## Other sources

- [OSM Ireland and Northern Ireland extract](https://download.geofabrik.de/europe/ireland-and-northern-ireland.html): useful supplement, but sport tags alone are sparse and miss operators such as Blast. A research query returned only six relevant sport-tagged records. Do not use [public Nominatim](https://operations.osmfoundation.org/policies/nominatim/) for bulk POI extraction or autocomplete.
- Windy and Surfline: do not scrape their spot catalogues without permission. Their [Windy terms](https://account.windy.com/agreements/windy-terms-of-use) and [Surfline terms](https://www.surfline.com/terms-of-use) restrict automated collection or extraction. A one-time scrape still needs permission where required.

## Suggested one-time import

1. Download Fáilte Ireland's CSV once; retain the source metadata and original record identifier.
2. Filter candidates, deduplicate by location/name, and manually classify beach, launch, school or shop. A business address must not become a launch pin.
3. Confirm coordinates, access, supported sports and restrictions with operators/clubs. Add Northern Ireland coverage through permissioned local sources.
4. Publish only reviewed records. Keep unverified candidates out of the main launch layer.
5. Store `id`, `name`, `county`, `lat`, `lon`, `kind`, `coordinateType`, `sports`, `sourceId`, `sourceUrl`, `licence`, `retrievedAt` and `verificationStatus`. Preserve source-specific licensing and identify any manual corrections.
6. Use existing source-backed point sampling for forecasts at new spots; do not manufacture time series or guess safe wind directions. Images, descriptions and safety guidance require separate sourcing/permission.

The first useful deliverable is a curated all-Ireland spot directory, not the largest possible unverified scrape.
