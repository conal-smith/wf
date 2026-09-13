import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
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
import ForecastSheet from "./ForecastSheet";
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
  KNOTS,
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

function Brand() {
  return (
    <a
      className="brand"
      href={import.meta.env.BASE_URL}
      aria-label="wingfoil.ie home"
    >
      <svg viewBox="0 0 45 42" aria-hidden="true">
        <path d="M3 29 19 5l22 18-20-7-8 13Z" fill="currentColor" />
        <path
          d="M16 36h23"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
      </svg>
      <span>
        wingfoil<span className="brand-domain">.ie</span>
      </span>
    </a>
  );
}

export default function App() {
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(170);
  const [, tick] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const modelRequest = useRef<AbortController | null>(null);
  const [pendingModel, setPendingModel] = useState<ModelId | null>(null);
  const [modelError, setModelError] = useState("");
  const [modelNotice, setModelNotice] = useState("");
  const modelEpoch = useRef(0);

  useEffect(() => () => modelRequest.current?.abort(), []);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      ["weather/latest.json", "spots.json"].map((path) =>
        fetch(`${import.meta.env.BASE_URL}${path}`, {
          signal: controller.signal,
          cache: "no-cache",
        }).then(async (r) => {
          if (!r.ok)
            throw new Error(
              "The forecast snapshot is missing. Run npm run weather:refresh, then reload.",
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
      setDockHeight(entry.contentRect.height + 50),
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
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || dialog.current?.open) return;
      if (searchOpen) {
        setSearchOpen(false);
        searchInput.current?.blur();
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
    <div className={`app-shell ${sheetOpen ? "sheet-open" : ""}`}>
      <header className="site-header">
        <div className="site-identity glass">
          <Brand />
          <span className="prototype-tag">PREVIEW</span>
        </div>
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
              onClick={() => {
                setSearchOpen(!searchOpen);
                if (!searchOpen) searchInput.current?.focus();
              }}
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
                  No matching spots. Try a county, or select a point on the map.
                </p>
              )}
            </section>
          )}
        </div>
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
              <div className="map-title-chip">
                <Force5Brand />
                <span>WIND · 10 m</span>
                <i />
                <label className="model-select">
                  <span className="sr-only">Weather model</span>
                  <select
                    aria-label="Weather model"
                    value={manifest?.model || "icon-eu"}
                    disabled={!frame || !!pendingModel}
                    onChange={(event) =>
                      void chooseModel(event.target.value as ModelId)
                    }
                  >
                    {MODELS.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} aria-hidden="true" />
                </label>
              </div>
              <div className="map-top-actions">
                <button
                  className={`layers-button ${showLayers ? "pressed" : ""}`}
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
            {!sheetOpen && (
              <div className="map-instruction glass">
                <span />{" "}
                {manifest?.model === "harmonie"
                  ? "HARMONIE: Ireland coverage only"
                  : "Select a spot. Find your wind."}
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
              <div className="map-footer-meta">
                <button className="model-info" onClick={openInfo}>
                  <Info size={14} />
                  <span>
                    {manifest?.modelName || "ICON-EU"} ·{" "}
                    {manifest?.resolutionKm || "6.5"} km{" "}
                    <span className="model-run">
                      ·{" "}
                      {manifest
                        ? `${new Date(manifest.runTime).toLocaleDateString("en-IE", { day: "2-digit", month: "short", timeZone: "UTC" })} ${new Date(manifest.runTime).getUTCHours().toString().padStart(2, "0")} UTC run`
                        : "Loading"}
                    </span>
                  </span>
                </button>
                <div className="legend">
                  <div className="legend-heading">
                    WIND SPEED <span>{units}</span>
                  </div>
                  <div className="legend-gradient" />
                  <div className="legend-ticks">
                    {[0, 10, 20, 30, 40, 50].map((v) => (
                      <span key={v}>
                        {Math.round(units === "kn" ? v : v / KNOTS)}
                        {v === 50 ? "+" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              {sheetOpen && manifest && (
                <ForecastSheet
                  manifest={manifest}
                  frame={frame}
                  point={point}
                  units={units}
                  index={activeIndex}
                  onSelect={selectTime}
                  onClose={() => {
                    setSheetOpen(false);
                    document
                      .querySelector<HTMLCanvasElement>(".maplibregl-canvas")
                      ?.focus();
                  }}
                />
              )}
              <div className="timeline">
                <div className="timeline-top">
                  <div className="timeline-date">
                    <span className="timeline-date-dot" />
                    {forecast
                      ? dayLabel(forecast.validTime)
                      : "Loading forecast"}
                    <strong>
                      {forecast ? timeLabel(forecast.validTime) : "—"}
                    </strong>
                  </div>
                  <div className="timeline-cadence">
                    {manifest?.stepHours || 3}-hour forecast steps
                    <span> · Irish time</span>
                  </div>
                  <button
                    className="now-button"
                    disabled={!manifest}
                    onClick={() =>
                      manifest && selectTime(nearestFrame(manifest.frames))
                    }
                  >
                    <Clock3 size={13} />
                    {isStale === "expired" ? "Latest" : "Now"}
                  </button>
                </div>
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
                      min="0"
                      max={Math.max(1, (manifest?.frames.length || 2) - 1)}
                      value={requestedIndex}
                      disabled={!manifest || !!pendingModel}
                      aria-label="Forecast time"
                      aria-valuetext={
                        manifest
                          ? `${dayLabel(manifest.frames[requestedIndex].validTime)} ${timeLabel(manifest.frames[requestedIndex].validTime)}`
                          : "Loading"
                      }
                      onChange={(e) => selectTime(Number(e.target.value))}
                    />
                    <div className="time-ticks">
                      {manifest?.frames
                        .filter((_, i) => i % 4 === 0)
                        .map((f) => (
                          <span key={f.hour}>{timeLabel(f.validTime)}</span>
                        ))}
                    </div>
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
                </div>
                <div className="timeline-days">
                  {manifest &&
                    Array.from(
                      new Set(
                        manifest.frames.map((f) => dayLabel(f.validTime)),
                      ),
                    ).map((day) => {
                      const idx = manifest.frames.findIndex(
                        (f) => dayLabel(f.validTime) === day,
                      );
                      return (
                        <button
                          key={day}
                          className={
                            forecast && dayLabel(forecast.validTime) === day
                              ? "active"
                              : ""
                          }
                          onClick={() => selectTime(idx)}
                        >
                          {day}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
          </section>
        </main>
      )}
      <footer className="site-footer">
        <span>
          <span
            className={`status-dot ${isStale !== "fresh" ? "warning" : ""}`}
          />
          {isStale === "expired"
            ? "Archived snapshot — forecast period has ended"
            : isStale === "stale"
              ? "Older model run — refresh recommended"
              : "Forecast data, not live observations"}
          <button onClick={openInfo}>Data & sources</button>
        </span>
        <span className="footer-right">
          Built for the days out there. <ArrowUpRight size={13} />
        </span>
      </footer>
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
                {manifest.resolutionKm} km native · display grid{" "}
                {manifest.grid.dx}° × {manifest.grid.dy}°
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
              : "npm run weather:refresh"}
          </code>
          , then reload. Forecasts are not automatically downloaded by the
          website yet; the previous successful snapshot is kept if a refresh
          fails.
        </p>
        <div className="source-links">
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
