import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Info,
  Layers3,
  MapPin,
  Pause,
  Play,
  Search,
  Wind,
  X,
} from "lucide-react";
import { WindMap, Force5Brand } from "../force5/src";
import ForecastSheet, { type ForecastSeries } from "./ForecastSheet";
import ModelPicker from "./ModelPicker";
import { windTrackBackground } from "../force5/src/timeline";
import { forecastUrl } from "../force5/src/urls";
import { loadModel, MODELS, type ModelId } from "../force5/src/models";
import {
  convert,
  dayLabel,
  freshness,
  loadFrame,
  nearestFrame,
  sample,
  speed,
  timeLabel,
  validateManifest,
  type Frame,
  type Manifest,
  type Point,
  type Spot,
  type Units,
} from "../force5/src";

const initialPoint: Point = {
  id: "brandon",
  name: "Brandon Bay",
  county: "Kerry",
  lat: 52.276,
  lon: -10.024,
};

export default function App() {
  const [pointSeries, setPointSeries] = useState<ForecastSeries | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null),
    [spots, setSpots] = useState<Spot[]>([]);
  const [frame, setFrame] = useState<Frame | null>(null),
    [requestedIndex, setRequestedIndex] = useState(0);
  const [point, setPoint] = useState<Point>(initialPoint),
    [units, setUnits] = useState<Units>("kn");
  const [error, setError] = useState(""),
    [frameError, setFrameError] = useState(""),
    [retry, setRetry] = useState(0);
  const [search, setSearch] = useState(""),
    [playing, setPlaying] = useState(false);
  const [showLayers, setShowLayers] = useState(false),
    [showWind, setShowWind] = useState(true),
    [particles, setParticles] = useState(true),
    [showSpots, setShowSpots] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(true);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(110);
  const [, tick] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const modelRequest = useRef<AbortController | null>(null);
  const [pendingModel, setPendingModel] = useState<ModelId | null>(null);
  const [modelError, setModelError] = useState("");
  const [modelNotice, setModelNotice] = useState("");
  useEffect(() => {
    if (!modelNotice) return;
    const timer = window.setTimeout(() => setModelNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [modelNotice]);
  const modelEpoch = useRef(0);

  useEffect(() => () => modelRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      ["weather/harmonie.json", "spots.json"].map((path) =>
        fetch(
          path.startsWith("weather/")
            ? forecastUrl(path)
            : `${import.meta.env.BASE_URL}${path}`,
          {
            signal: controller.signal,
            cache: "no-cache",
          },
        ).then(async (r) => {
          if (!r.ok)
            throw new Error(
              "The forecast snapshot is missing. Run npm run weather:refresh:harmonie, then reload.",
            );
          return r.json();
        }),
      ),
    )
      .then(([m, s]) => {
        if (controller.signal.aborted) return;
        const validated = validateManifest(m);
        setManifest(validated);
        setSpots(s);
        setRequestedIndex(nearestFrame(validated.frames));
        setPoint(
          s.find((spot: Spot) => spot.id === initialPoint.id) || initialPoint,
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Unable to open forecast data.",
          );
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => {
      setReducedMotion(media.matches);
      if (media.matches) setPlaying(false);
    };
    media.addEventListener("change", change);
    const interval = window.setInterval(() => tick((v) => v + 1), 60000);
    return () => {
      media.removeEventListener("change", change);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!dock.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setDockHeight(entry.target.getBoundingClientRect().height),
    );
    observer.observe(dock.current);
    return () => observer.disconnect();
  }, [error]);

  useEffect(() => {
    if (!manifest || pendingModel) return;
    let cancelled = false;
    const epoch = modelEpoch.current;
    setFrameError("");
    loadFrame(manifest, requestedIndex)
      .then((data) => {
        if (cancelled || epoch !== modelEpoch.current) return;
        setFrame(data);
        if (requestedIndex + 1 < manifest.frames.length)
          void loadFrame(manifest, requestedIndex + 1).catch(() => {});
      })
      .catch((e) => {
        if (!cancelled && epoch === modelEpoch.current) {
          setFrameError(e.message);
          setPlaying(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [manifest, requestedIndex, retry, pendingModel]);

  const activeIndex =
    manifest && frame
      ? manifest.frames.findIndex((f) => f.hour === frame.hour)
      : requestedIndex;
  const loading = !frame || activeIndex !== requestedIndex;
  useEffect(() => {
    if (!playing || !manifest || loading || frameError) return;
    const timeout = window.setTimeout(() => {
      if (requestedIndex >= manifest.frames.length - 1) setPlaying(false);
      else setRequestedIndex((v) => v + 1);
    }, 1600);
    return () => clearTimeout(timeout);
  }, [playing, manifest, requestedIndex, loading, frameError]);

  const forecast = manifest?.frames[activeIndex];
  const seriesKey = `${manifest?.model}/${manifest?.run}/${point.lon}/${point.lat}`;
  const timelineValues =
    (point.id && manifest?.spotForecasts[point.id]) ||
    (pointSeries?.key === seriesKey ? pointSeries.values : []);
  const isStale = manifest ? freshness(manifest) : "fresh";
  const visibleSpots = spots.filter((s) =>
    `${s.name} ${s.county}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selectTime = (i: number) => {
    if (pendingModel) return;
    setModelNotice("");
    setPlaying(false);
    setRequestedIndex(i);
  };
  const selectSpot = (spot: Point) => {
    setPoint(spot);
    setSearchOpen(false);
    setSheetOpen(true);
  };
  const closeSearch = () => {
    setSearchOpen(false);
    requestAnimationFrame(() => searchTrigger.current?.focus());
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dialog.current?.open) return;
      if (searchOpen) {
        closeSearch();
      } else if (showLayers) setShowLayers(false);
      else {
        setSheetOpen(false);
        document
          .querySelector<HTMLCanvasElement>(".maplibregl-canvas")
          ?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [searchOpen, showLayers]);
  const openInfo = () => dialog.current?.showModal();
  const chooseModel = async (id: ModelId) => {
    if (!manifest || !frame || id === manifest.model) return;
    modelRequest.current?.abort();
    const controller = new AbortController();
    modelRequest.current = controller;
    modelEpoch.current++;
    setPlaying(false);
    setRequestedIndex(activeIndex);
    setPendingModel(id);
    setModelError("");
    setModelNotice("");
    setFrameError("");
    const targetTime = frame.validTime;
    try {
      const next = await loadModel(id, targetTime, controller.signal);
      if (controller.signal.aborted) return;
      // React batches these together: metadata, map, series and time commit atomically.
      setManifest(next.manifest);
      setFrame(next.frame);
      setRequestedIndex(next.index);
      if (next.frame.validTime !== targetTime)
        setModelNotice(
          `Showing the nearest ${next.manifest.modelName} forecast: ${dayLabel(next.frame.validTime)} ${timeLabel(next.frame.validTime)}. Model forecast times and ranges differ.`,
        );
    } catch (error) {
      if (!controller.signal.aborted)
        setModelError(
          `Could not switch to ${MODELS.find((m) => m.id === id)?.name}. ${manifest.modelName} is still shown. ${error instanceof Error ? error.message : "Please try again."}`,
        );
    } finally {
      if (modelRequest.current === controller) setPendingModel(null);
    }
  };
  const togglePlayback = () => {
    if (!playing && manifest && requestedIndex === manifest.frames.length - 1)
      setRequestedIndex(0);
    setPlaying((v) => !v);
  };

  return (
    <div
      className={`app-shell compact-layout ${sheetOpen ? "sheet-open" : ""}`}
      style={{ "--dock-height": `${dockHeight}px` } as React.CSSProperties}
    >
      <header className="site-header">
        <button
          ref={searchTrigger}
          className="search-trigger glass"
          aria-label="Open spot search"
          aria-expanded={searchOpen}
          aria-controls="spot-search-results"
          hidden={searchOpen}
          onClick={() => setSearchOpen(true)}
        >
          <Search size={20} />
        </button>
        {searchOpen && (
          <div className="search-panel">
            <div className="search-box glass">
              <Search size={18} />
              <input
                ref={searchInput}
                type="search"
                aria-label="Search Irish spots"
                aria-expanded={searchOpen}
                aria-controls="spot-search-results"
                placeholder="Find a spot or county"
                value={search}
                onFocus={() => setSearchOpen(true)}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSearchOpen(true);
                }}
              />
              <button
                aria-label={
                  searchOpen ? "Close spot search" : "Browse Irish spots"
                }
                onClick={closeSearch}
              >
                {searchOpen ? <X size={17} /> : <MapPin size={17} />}
              </button>
            </div>
            {searchOpen && (
              <section
                id="spot-search-results"
                className="search-results glass"
                aria-label="Irish spots"
              >
                <div className="section-label">
                  EXPLORE THE COAST <span>{visibleSpots.length} spots</span>
                </div>
                {visibleSpots.map((spot) => {
                  const w = frame ? sample(frame, spot.lon, spot.lat) : null;
                  return (
                    <button
                      key={spot.id}
                      className="spot-row"
                      onClick={() => selectSpot(spot)}
                    >
                      <MapPin size={16} />
                      <span className="spot-row-name">
                        {spot.name}
                        <small>{spot.county}</small>
                      </span>
                      <span className="spot-row-wind">
                        {w ? Math.round(convert(speed(w), units)) : "—"}{" "}
                        <small>{units}</small>
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  );
                })}
                {!visibleSpots.length && (
                  <p className="empty-spots">
                    No matching spots. Try a county, or select a point on the
                    map.
                  </p>
                )}
              </section>
            )}
          </div>
        )}
      </header>
      {error ? (
        <main className="fatal-error">
          <Wind size={36} />
          <h1>The forecast isn’t ready yet.</h1>
          <p role="alert">{error}</p>
          <button className="primary-button" onClick={() => location.reload()}>
            Try again
          </button>
        </main>
      ) : (
        <main className="workspace">
          <section className="map-panel" aria-label="Wind explorer">
            <WindMap
              frame={frame}
              spots={spots}
              selected={point}
              units={units}
              onSelect={selectSpot}
              showWind={showWind}
              particles={particles}
              showSpots={showSpots}
              reducedMotion={reducedMotion}
              selectionOpen={sheetOpen}
              bottomInset={dockHeight}
            />
            <div className="map-topbar">
              <button
                className="platform-brand"
                aria-label="About Force5"
                onClick={openInfo}
              >
                <Force5Brand />
              </button>
              <div className="map-top-actions">
                <button
                  className={`layers-button ${showLayers ? "pressed" : ""}`}
                  aria-label="Layers"
                  aria-expanded={showLayers}
                  onClick={() => {
                    setShowLayers((v) => !v);
                    setSearchOpen(false);
                  }}
                >
                  <Layers3 size={17} />
                  <span>Layers</span>
                </button>
              </div>
            </div>
            {showLayers && (
              <div className="layers-panel">
                <div className="section-label">
                  MAP DISPLAY
                  <button
                    aria-label="Close layers"
                    onClick={() => setShowLayers(false)}
                  >
                    <X size={15} />
                  </button>
                </div>
                <label>
                  <span>Wind colours</span>
                  <input
                    type="checkbox"
                    checked={showWind}
                    onChange={(e) => setShowWind(e.target.checked)}
                  />
                </label>
                <label>
                  <span>Moving particles</span>
                  <input
                    type="checkbox"
                    checked={particles && !reducedMotion}
                    disabled={reducedMotion}
                    onChange={(e) => setParticles(e.target.checked)}
                  />
                </label>
                <label>
                  <span>Wingfoil spots</span>
                  <input
                    type="checkbox"
                    checked={showSpots}
                    onChange={(e) => setShowSpots(e.target.checked)}
                  />
                </label>
                {reducedMotion && (
                  <p>
                    Animation is off to respect your reduced-motion setting.
                  </p>
                )}
                <div className="unit-control">
                  <span>Wind units</span>
                  <div>
                    <button
                      aria-pressed={units === "kn"}
                      onClick={() => setUnits("kn")}
                    >
                      knots
                    </button>
                    <button
                      aria-pressed={units === "m/s"}
                      onClick={() => setUnits("m/s")}
                    >
                      m/s
                    </button>
                  </div>
                </div>
              </div>
            )}
            {(pendingModel || modelError || modelNotice) && (
              <div
                className={`frame-status model-status ${modelError ? "is-error" : ""}`}
                role="status"
              >
                {pendingModel ? (
                  <>
                    <span className="spinner" />
                    Loading {
                      MODELS.find((m) => m.id === pendingModel)?.name
                    }… {manifest?.modelName} is still shown.
                    <button
                      onClick={() => {
                        modelRequest.current?.abort();
                        setPendingModel(null);
                      }}
                    >
                      Cancel switch
                    </button>
                  </>
                ) : (
                  <>
                    {modelError || modelNotice}
                    <button
                      aria-label="Dismiss model message"
                      onClick={() => {
                        setModelError("");
                        setModelNotice("");
                      }}
                    >
                      <X size={14} />
                    </button>
                  </>
                )}
              </div>
            )}
            {(loading || frameError) &&
              !pendingModel &&
              !modelError &&
              !modelNotice && (
                <div
                  className={`frame-status ${frameError ? "is-error" : ""}`}
                  role="status"
                >
                  {frameError ? (
                    <>
                      {frameError}
                      <button onClick={() => setRetry((v) => v + 1)}>
                        Retry
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="spinner" /> Loading{" "}
                      {manifest
                        ? timeLabel(manifest.frames[requestedIndex].validTime)
                        : "wind data"}
                      …{frame && " Previous frame is still shown."}
                    </>
                  )}
                </div>
              )}
            <div className="map-footer" ref={dock}>
              <div className="timeline">
                <div className="timeline-controls">
                  <button
                    className="play-button"
                    aria-label={playing ? "Pause forecast" : "Play forecast"}
                    disabled={!manifest || !!frameError || !!pendingModel}
                    onClick={togglePlayback}
                  >
                    {playing ? (
                      <Pause size={17} fill="currentColor" />
                    ) : (
                      <Play size={17} fill="currentColor" />
                    )}
                  </button>
                  <button
                    className="step-button"
                    aria-label="Previous forecast"
                    disabled={requestedIndex === 0 || !manifest}
                    onClick={() => selectTime(requestedIndex - 1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <div className="slider-track">
                    <input
                      type="range"
                      style={{
                        background: windTrackBackground(
                          timelineValues,
                          manifest?.frames.length || 0,
                          manifest?.frames.map((f) => f.hour),
                        ),
                      }}
                      title="Track colours show forecast wind speed at the selected location"
                      min="0"
                      max={
                        manifest?.stepRanges
                          ? manifest.frames.at(-1)!.hour
                          : Math.max(1, (manifest?.frames.length || 2) - 1)
                      }
                      value={
                        manifest?.stepRanges
                          ? manifest.frames[requestedIndex].hour
                          : requestedIndex
                      }
                      disabled={!manifest || !!pendingModel}
                      aria-label="Forecast time"
                      aria-valuetext={
                        manifest
                          ? `${dayLabel(manifest.frames[requestedIndex].validTime)} ${timeLabel(manifest.frames[requestedIndex].validTime)}`
                          : "Loading"
                      }
                      onChange={(e) =>
                        selectTime(
                          manifest?.stepRanges
                            ? nearestFrame(
                                manifest.frames,
                                Date.parse(manifest.runTime) +
                                  Number(e.target.value) * 3600000,
                              )
                            : Number(e.target.value),
                        )
                      }
                      onKeyDown={(e) => {
                        if (!manifest?.stepRanges) return;
                        const delta = {
                          ArrowRight: 1,
                          ArrowUp: 1,
                          ArrowLeft: -1,
                          ArrowDown: -1,
                          PageUp: 4,
                          PageDown: -4,
                        }[e.key];
                        if (delta !== undefined) {
                          e.preventDefault();
                          selectTime(
                            Math.max(
                              0,
                              Math.min(
                                manifest.frames.length - 1,
                                requestedIndex + delta,
                              ),
                            ),
                          );
                        }
                      }}
                    />
                  </div>
                  <button
                    className="step-button"
                    aria-label="Next forecast"
                    disabled={
                      !manifest || requestedIndex === manifest.frames.length - 1
                    }
                    onClick={() => selectTime(requestedIndex + 1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                  {sheetOpen && (
                    <button
                      className="grid-close"
                      aria-label="Close forecast panel"
                      onClick={() => {
                        setSheetOpen(false);
                        document
                          .querySelector<HTMLCanvasElement>(
                            ".maplibregl-canvas",
                          )
                          ?.focus();
                      }}
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              </div>
              {sheetOpen && manifest && (
                <ForecastSheet
                  manifest={manifest}
                  point={point}
                  units={units}
                  index={activeIndex}
                  scrollIndex={frameError ? activeIndex : requestedIndex}
                  onSeriesChange={setPointSeries}
                  onSelect={selectTime}
                />
              )}
            </div>
            <div className="map-model-controls">
              <ModelPicker
                model={manifest?.model}
                disabled={!frame || !!pendingModel}
                onSelect={(id) => void chooseModel(id)}
              />
              <button
                className="model-info"
                onClick={openInfo}
                aria-label="Forecast data and sources"
              >
                <Info size={14} />
                <span>
                  {manifest?.modelName || "HARMONIE"} ·{" "}
                  {manifest?.resolutionLabel ||
                    `${manifest?.resolutionKm || 2} km`}
                </span>
              </button>
              <span className="site-footer" role="status">
                {isStale === "expired"
                  ? "Archived snapshot"
                  : isStale === "stale"
                    ? (forecast?.hour || 0) >= 168
                      ? "Older run · long-range outlook"
                      : "Older model run"
                    : (forecast?.hour || 0) >= 168
                      ? "Long-range outlook · less certain"
                      : ""}
              </span>
            </div>
            <div className="map-credits" aria-label="Map attribution">
              <a
                href="https://openmaptiles.org/"
                target="_blank"
                rel="noreferrer"
              >
                © OpenMapTiles
              </a>
              {" · "}
              <a
                href="https://www.openstreetmap.org/copyright"
                target="_blank"
                rel="noreferrer"
              >
                © OpenStreetMap contributors
              </a>
            </div>
          </section>
        </main>
      )}
      <dialog
        ref={dialog}
        className="info-dialog"
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current.close();
        }}
      >
        <button
          className="dialog-close"
          aria-label="Close forecast information"
          onClick={() => dialog.current?.close()}
        >
          <X size={20} />
        </button>
        <Force5Brand />
        <div className="eyebrow">BEHIND THE FORECAST</div>
        <h2>A clearer picture of the wind.</h2>
        <p>
          Force5 powers this wind map using real {manifest?.provider || "DWD"}{" "}
          {manifest?.modelDetail || manifest?.modelName || "ICON-EU"} model
          output, cropped to Ireland. Colours, particle direction and spot
          readings all use the same 10 m wind grid.
        </p>
        {manifest && (
          <dl>
            <div>
              <dt>Model resolution</dt>
              <dd>
                {manifest.resolutionLabel ||
                  `${manifest.resolutionKm} km native`}{" "}
                · display grid {manifest.grid.dx}° × {manifest.grid.dy}°
              </dd>
            </div>
            <div>
              <dt>Model initialised</dt>
              <dd>{new Date(manifest.runTime).toUTCString()}</dd>
            </div>
            <div>
              <dt>Forecast coverage</dt>
              <dd>
                {dayLabel(manifest.frames[0].validTime)}{" "}
                {timeLabel(manifest.frames[0].validTime)} →{" "}
                {dayLabel(manifest.frames.at(-1)!.validTime)}{" "}
                {timeLabel(manifest.frames.at(-1)!.validTime)}
              </dd>
            </div>
            <div>
              <dt>Forecast intervals</dt>
              <dd>
                {manifest.stepRanges
                  ? "3-hourly through day 6; 6-hourly through day 15"
                  : `${manifest.stepHours}-hourly`}
              </dd>
            </div>
            <div>
              <dt>Snapshot prepared</dt>
              <dd>{new Date(manifest.generatedAt).toUTCString()}</dd>
            </div>
          </dl>
        )}
        <p>
          <strong>What you’re seeing.</strong> Wind is interpolated between
          model grid points. Direction labels show where wind comes from;
          particles and arrows travel downwind. Particle speed is illustrative.
          Gusts are modelled maxima over the source interval
          {forecast?.gustIntervalHours
            ? ` (+${forecast.gustIntervalHours[0]} to +${forecast.gustIntervalHours[1]} hours from the model run)`
            : ""}
          ; they are not continuous measurements.
        </p>
        {manifest?.gustDescription && (
          <p>
            <strong>Gust availability.</strong> {manifest.gustDescription}
          </p>
        )}
        {manifest?.processing && (
          <p>
            <strong>Map processing.</strong> {manifest.processing}
          </p>
        )}
        <p>
          <strong>Before heading out.</strong> Even a high-resolution model
          cannot fully resolve an individual launch, headland or sheltered bay.
          This prototype does not include waves, tides or warning feeds. Check{" "}
          <a
            href="https://www.met.ie/warnings"
            target="_blank"
            rel="noreferrer"
          >
            Met Éireann warnings
          </a>{" "}
          and local conditions.
        </p>
        {point.note && (
          <p className="spot-note">
            <MapPin size={16} />
            <span>
              <strong>{point.name}:</strong> {point.note}
            </span>
          </p>
        )}
        <p>
          <strong>Refreshing the snapshot.</strong> Run{" "}
          <code>
            {manifest?.model === "harmonie"
              ? "npm run weather:refresh:harmonie"
              : manifest?.model === "ecmwf"
                ? "npm run weather:refresh:ecmwf"
                : "npm run weather:refresh"}
          </code>
          , then reload. Forecasts are not automatically downloaded by the
          website yet; the previous successful snapshot is kept if a refresh
          fails.
        </p>
        <div className="source-links">
          {manifest?.termsUrl && (
            <a href={manifest.termsUrl} target="_blank" rel="noreferrer">
              Provider terms <ArrowUpRight size={14} />
            </a>
          )}
          <a
            href={
              manifest?.sourceUrl ||
              "https://opendata.dwd.de/weather/nwp/icon-eu/grib/"
            }
            target="_blank"
            rel="noreferrer"
          >
            {manifest?.provider || "DWD"} forecast data{" "}
            <ArrowUpRight size={14} />
          </a>
          <a
            href={
              manifest?.licenseUrl ||
              "https://www.dwd.de/EN/service/legal_notice/legal_notice_node.html"
            }
            target="_blank"
            rel="noreferrer"
          >
            Data licence <ArrowUpRight size={14} />
          </a>
          <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
            OpenFreeMap basemap <ArrowUpRight size={14} />
          </a>
        </div>
        <small>{manifest?.attribution}</small>
      </dialog>
    </div>
  );
}
