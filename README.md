# wingfoil.ie

The wing-foil forecast for Ireland, drawn as an Admiralty chart crossed with an
old broadsheet weather report (see [the brand](docs/BRAND.md)). The map shows
the forecast wind over EMODnet depths, and every riding place as a light rated
in stars for the hour selected; the dock below it is the chosen spot's week,
hour by hour. The forecasts are Met Éireann HARMONIE, DWD ICON-EU, ECMWF IFS
and AIFS, NOAA GFS and GEFS, Météo-France ARPEGE and AROME, blended.

## Run the website

Requires Node.js 22.12+ and npm.

```sh
npm ci
npm run weather:sample   # synthetic forecast bundles; no forecast data is committed
npm run dev
```

Open **http://127.0.0.1:5173/**. The sample bundles say in their attribution
that they are not a forecast; [the live pipeline](docs/LIVE_FORECAST_PIPELINE.md)
fetches real runs.

## Checks

```sh
npm test           # unit tests
npm run build      # type-check and build
npm run ui:lint    # design-system and UI rules
npm run test:e2e   # Playwright
```

## Docs

- [Live forecast pipeline](docs/LIVE_FORECAST_PIPELINE.md) and [the data plan](docs/FORECAST_DATA_PLAN.md)
- [Star ratings](docs/STAR_RATINGS.md) and [model verification](docs/VERIFICATION.md)
- [Design system](docs/DESIGN_SYSTEM.md) and [design principles](docs/DESIGN_PRINCIPLES.md)
- [Builds and releases](docs/RELEASES.md)
- [Running it on one machine](deploy/local/README.md)
- [Where the riding places come from](data/locations/README.md)

## Contributing

Issues and pull requests are welcome; [`CONTRIBUTING.md`](CONTRIBUTING.md)
lists the checks a change has to pass. Report security problems privately, as
[`SECURITY.md`](SECURITY.md) describes.

## Licence

The code is licensed under the [GNU Affero General Public License v3.0](LICENSE)
(`AGPL-3.0-only`): if you run a modified version as a service, you must offer
its source to the people using it. Data the site reads keeps its own licence,
credited where it is shown: forecasts from Met Éireann, DWD, ECMWF, NOAA,
Météo-France and the Marine Institute; places from Fáilte Ireland (CC BY 4.0),
OpenStreetMap (ODbL) and the sources listed in
[`data/locations/README.md`](data/locations/README.md); depths from EMODnet
Bathymetry (CC BY 4.0).
