# Contributing

Thanks for helping. wingfoil.ie is a small project, so a short issue describing
the problem or idea before a large change saves everyone time.

## Running it

[The README](README.md#run-the-website) has the details. In short, Node 22.12+
and npm for the site, and Python 3.12 with `force5/ingest/requirements-worker.txt`
for the forecast importers:

```sh
npm ci
npm run weather:sample   # synthetic forecasts, so the map draws without any download
npm run dev
```

## What a change has to pass

CI runs these on every pull request (`.github/workflows/ci.yml`). Run the ones
your change touches before you push:

```sh
npm run build            # tsc -b and the Vite build
npm test                 # every unit test vitest finds
npm run ui:lint          # the theme and design-system lints
npm run test:weather     # the importers' Python tests
npx playwright test --project=desktop --project=phone   # end to end, against synthetic data
```

If you change a Dockerfile, the worker's Python dependencies or anything the
images copy, build the image and run its smoke test:

```sh
docker build -f force5/Dockerfile -t wingfoil-forecast:dev .
scripts/release/worker-image-smoke.sh wingfoil-forecast:dev
```

The worker image installs under `force5/ingest/requirements-lock.txt`. A new
Python dependency goes in `requirements-worker.txt` **and** is pinned, together
with whatever it pulls in, in the lock file.

## Style

Match the code around you: the comments say why, the names say what. The design
rules are in [docs/BRAND.md](docs/BRAND.md) and
[docs/DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md), and every colour and
control comes from `ui/`.

## Licence

By contributing you agree that your contribution is licensed under the
[AGPL-3.0](LICENSE), like the rest of the code.
