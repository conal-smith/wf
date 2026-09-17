import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  Info,
  Layers3,
  MapPin,
  Search,
  Wind,
  X,
} from "lucide-react";
import { WindMap, Force5Brand } from "../force5/src";
import ForecastDock from "./ForecastDock";
import ModelPicker from "./ModelPicker";
import useRunRefresh, { loadNewerRun, type RunSwap } from "./useRunRefresh";
import { ridingLocations } from "./locations";
import { forecastUrl } from "../force5/src/urls";
import { runLabel } from "../force5/src/revalidate";
import { loadModel, MODELS, type ModelId } from "../force5/src/models";
import { useModelAvailability } from "./useBlend";
import {
  dockColumns,
  frameForTime,
  type ColumnModel,
  type DockColumn,
} from "../force5/src/timeline";
import {
  convert,
  dayLabel,
  defaultPrefs,
  freshness,
  loadFrame,
  loadPrefs,
  nearestFrame,
  sample,
  savePrefs,
  speed,
  timeLabel,
  validateManifest,
  type Frame,
  type Manifest,
  type Point,
  type Prefs,
  type Spot,
} from "../force5/src";

const initialPoint: Point = {
  id: "brandon",
  name: "Brandon Bay",
  county: "Kerry",
  lat: 52.276,
  lon: -10.024,
};

export default function App() {
  // Display preferences drive the dock, the table and the map readouts alike.
  const [prefs, setPrefs] = useState<Prefs>(defaultPrefs);
  useEffect(() => setPrefs(loadPrefs()), []);
  const changePrefs = (next: Prefs) => {
    setPrefs(next);
    savePrefs(next);
  };
  const units = prefs.units;
  const [manifest, setManifest] = useState<Manifest | null>(null),
    [spots, setSpots] = useState<Spot[]>([]);
  const [frame, setFrame] = useState<Frame | null>(null),
    // The reader's place in the forecast is a valid time, never an index. An
    // index only means something inside one run of one model, and the dock's
    // columns will outlive both; the map frame and the dock column are derived.
    [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [point, setPoint] = useState<Point>(initialPoint);
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
  const [spotInfoOpen, setSpotInfoOpen] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
  }, [searchOpen]);

  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(110);
  // A coarse clock. The Now line has its own; this one decides which runs have
  // expired, so it only has to be right to the minute.
  const [clock, setClock] = useState(() => Date.now());
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
        setSpots(ridingLocations(s));
        setSelectedTime(
          validated.frames[nearestFrame(validated.frames)].validTime,
        );
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
    const now = () => setClock(Date.now());
    const interval = window.setInterval(now, 60000);
    document.addEventListener("visibilitychange", now);
    window.addEventListener("focus", now);
    return () => {
      media.removeEventListener("change", change);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", now);
      window.removeEventListener("focus", now);
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

  // A newer run replaces the one on screen: metadata, map, series and time
  // commit together, exactly as a model switch does.
  const commitRun = ({ manifest: next, frame: nextFrame, index }: RunSwap) => {
    modelEpoch.current++;
    setManifest(next);
    setFrame(nextFrame);
    setSelectedTime(next.frames[index].validTime);
    setFrameError("");
    setModelError("");
    setModelNotice(`Updated to the ${runLabel(next.runTime)} run.`);
  };

  // The frame the map is painting right now, by its own hour.
  const paintedIndex =
    manifest && frame
      ? manifest.frames.findIndex((f) => f.hour === frame.hour)
      : -1;
  /**
   * The map frame the selected time asks for. Nothing stores this: a run swap
   * or a model switch changes which frame a time lands on, and deriving it is
   * what keeps the reader's place through both.
   *
   * A time this run cannot reach — the dock's columns run fifteen days and
   * HARMONIE sixty hours — leaves the map exactly where it is. The dock offers
   * the run that does reach it; nothing switches on the reader's behalf.
   */
  const requestedIndex =
    manifest && selectedTime
      ? (frameForTime(manifest.frames, Date.parse(selectedTime)) ??
        (paintedIndex >= 0
          ? paintedIndex
          : nearestFrame(manifest.frames, Date.parse(selectedTime))))
      : 0;

  // The sweep lives here rather than in the dock because the dock's columns are
  // built from every model's manifest, not just the one the map is drawing.
  const { models, resolved: modelsResolved } = useModelAvailability(
    playing || !!pendingModel,
  );
  const columnModels = useMemo<ColumnModel[]>(() => {
    const list = models
      .filter((model) => model.wind !== null)
      .map((model) => ({
        id: model.id,
        manifest: model.wind!,
        ensemble: model.entry.ensemble,
      }));
    if (!manifest) return list;
    // The run on screen is the authority for its own model: a run swap must not
    // wait for the next five-minute sweep before the columns agree with the map.
    const mine = { id: manifest.model, manifest, ensemble: false };
    const at = list.findIndex((model) => model.id === manifest.model);
    if (at === -1) return [...list, mine];
    return list.map((model, index) => (index === at ? mine : model));
  }, [models, manifest]);
  // Kept by identity so a minute's tick, or a sweep that says the same thing,
  // does not rebuild every chart and re-run the dock's measurement pass.
  const lastColumns = useRef<DockColumn[]>([]);
  const columns = useMemo(() => {
    const built = dockColumns(columnModels, clock);
    // Until the sweep resolves there is one manifest to go on, and it is the
    // map's. The selection survives the change because it is a time.
    const next = built.length
      ? built
      : manifest
        ? manifest.frames.map((frame) => ({
            validTime: frame.validTime,
            model: manifest.model,
          }))
        : [];
    const previous = lastColumns.current;
    if (
      previous.length === next.length &&
      previous.every(
        (column, index) =>
          column.validTime === next[index].validTime &&
          column.model === next[index].model,
      )
    )
      return previous;
    lastColumns.current = next;
    return next;
  }, [columnModels, manifest, clock]);

  useEffect(() => {
    if (!manifest || pendingModel) return;
    const controller = new AbortController();
    const epoch = modelEpoch.current;
    const current = () =>
      !controller.signal.aborted && epoch === modelEpoch.current;
    setFrameError("");
    loadFrame(manifest, requestedIndex)
      .then((data) => {
        if (!current()) return;
        setFrame(data);
        if (requestedIndex + 1 < manifest.frames.length)
          void loadFrame(manifest, requestedIndex + 1).catch(() => {});
      })
      .catch(async (e) => {
        if (!current()) return;
        // The server keeps only the newest run, so a frame that has gone usually
        // means a newer run replaced it: open that run at the same time instead
        // of reporting an error about a forecast nobody should be reading.
        const swap = await loadNewerRun(
          manifest,
          manifest.frames[requestedIndex].validTime,
          controller.signal,
        ).catch(() => null);
        if (!current()) return;
        if (swap) return commitRun(swap);
        setFrameError(e.message);
        setPlaying(false);
      });
    return () => controller.abort();
  }, [manifest, requestedIndex, retry, pendingModel]);

  const activeIndex = paintedIndex >= 0 ? paintedIndex : requestedIndex;
  const loading = !frame || activeIndex !== requestedIndex;
  useEffect(() => {
    if (!playing || !manifest || loading || frameError) return;
    const timeout = window.setTimeout(() => {
      // Playback steps through the map model's own frames, by time.
      const next = manifest.frames[requestedIndex + 1];
      if (!next) setPlaying(false);
      else setSelectedTime(next.validTime);
    }, 1600);
    return () => clearTimeout(timeout);
  }, [playing, manifest, requestedIndex, loading, frameError]);

  const forecast = manifest?.frames[activeIndex];
  const isStale = manifest ? freshness(manifest) : "fresh";
  const visibleSpots = spots.filter((s) =>
    `${s.name} ${s.county} ${(s.aliases || []).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  /** The one way the reader's place moves: a valid time, from any control. */
  const selectTime = (validTime: string) => {
    if (pendingModel) return;
    setModelNotice("");
    setPlaying(false);
    setSelectedTime(validTime);
  };
  const selectSpot = (spot: Point) => {
    setPoint(spot);
    setSearchOpen(false);
    setSheetOpen(true);
    setSpotInfoOpen(!!spot.id);
  };
  const closeSpotInfo = () => {
    setSpotInfoOpen(false);
    requestAnimationFrame(() => {
      if (point.id)
        document
          .querySelector<HTMLButtonElement>(
            `[data-spot-id="${CSS.escape(point.id)}"]`,
          )
          ?.focus({ preventScroll: true });
    });
  };
  const closeSearch = () => {
    setSearchOpen(false);
    requestAnimationFrame(() => searchTrigger.current?.focus());
  };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      // A dialog of our own - the source sheet or the display filter - owns
      // Escape while it is open.
      if (event.key !== "Escape" || document.querySelector("dialog[open]"))
        return;
      if (searchOpen) {
        closeSearch();
      } else if (showLayers) setShowLayers(false);
      else if (spotInfoOpen) closeSpotInfo();
      else {
        setSheetOpen(false);
        document
          .querySelector<HTMLCanvasElement>(".maplibregl-canvas")
          ?.focus();
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [searchOpen, showLayers, spotInfoOpen, point.id]);
  const openInfo = () => dialog.current?.showModal();
  const chooseModel = async (id: ModelId, wanted?: string) => {
    if (!manifest || !frame || (id === manifest.model && !wanted)) return;
    modelRequest.current?.abort();
    const controller = new AbortController();
    modelRequest.current = controller;
    modelEpoch.current++;
    setPlaying(false);
    setPendingModel(id);
    setModelError("");
    setModelNotice("");
    setFrameError("");
    const targetTime = wanted ?? frame.validTime;
    setSelectedTime(targetTime);
    try {
      const next = await loadModel(id, targetTime, controller.signal);
      if (controller.signal.aborted) return;
      // React batches these together: metadata, map, series and time commit atomically.
      setManifest(next.manifest);
      setFrame(next.frame);
      setSelectedTime(next.frame.validTime);
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
  // A tab left open follows the runs. The check is silent unless it finds a new
  // one, and the swap is the same atomic manifest/frame/time commit a model
  // switch makes, at the frame nearest the time the reader had selected.
  useRunRefresh({
    manifest,
    validTime: selectedTime ?? frame?.validTime ?? null,
    switching: !!pendingModel,
    playing,
    onRun: commitRun,
  });
  const togglePlayback = () => {
    if (!playing && manifest && requestedIndex === manifest.frames.length - 1)
      setSelectedTime(manifest.frames[0].validTime);
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
                  EXPLORE THE COAST <span>{visibleSpots.length} locations</span>
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
              spotInfoOpen={spotInfoOpen}
              onCloseSpotInfo={closeSpotInfo}
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
                  <span>Wind-sport locations</span>
                  <input
                    type="checkbox"
                    checked={showSpots}
                    onChange={(e) => {
                      setShowSpots(e.target.checked);
                      if (!e.target.checked) setSpotInfoOpen(false);
                    }}
                  />
                </label>
                {reducedMotion && (
                  <p>
                    Animation is off to respect your reduced-motion setting.
                  </p>
                )}
                <p className="layers-hint">
                  Wind units live in the forecast dock&rsquo;s display options.
                </p>
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
              {manifest && (
                <ForecastDock
                  manifest={manifest}
                  columns={columns}
                  models={models}
                  modelsResolved={modelsResolved}
                  point={point}
                  prefs={prefs}
                  onPrefsChange={changePrefs}
                  selectedTime={
                    selectedTime ?? manifest.frames[requestedIndex].validTime
                  }
                  // A frame that failed must not drag the dock to a column the
                  // map never reached; the last good one keeps the view.
                  scrollTime={
                    frameError ? (forecast?.validTime ?? null) : selectedTime
                  }
                  onSelect={selectTime}
                  // The chip is the only way a far column changes the map, and
                  // it is the reader's own decision: nothing switches by itself.
                  onShowOnMap={(id, validTime) =>
                    void chooseModel(id, validTime)
                  }
                  open={sheetOpen}
                  onClose={() => {
                    setSheetOpen(false);
                    document
                      .querySelector<HTMLCanvasElement>(".maplibregl-canvas")
                      ?.focus();
                  }}
                  playing={playing}
                  onTogglePlay={togglePlayback}
                  busy={!!pendingModel}
                  playDisabled={!!frameError || !!pendingModel}
                  reducedMotion={reducedMotion}
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
        </p>
        <p>
          <strong>Two kinds of gust.</strong> Most sources publish a modelled{" "}
          <em>maximum over an accumulation window</em> ending at the forecast
          time
          {manifest?.gustKind !== "instantaneous" && forecast?.gustIntervalHours
            ? ` (+${forecast.gustIntervalHours[0]} to +${forecast.gustIntervalHours[1]} hours from the model run)`
            : ""}
          ; others publish an <em>instantaneous</em> gust, a point value at the
          forecast time itself, which has a reading at initialization where a
          window-based gust has none.{" "}
          {manifest?.gustKind === "instantaneous"
            ? `${manifest.modelName} publishes instantaneous gusts.`
            : manifest?.gustAvailable === false
              ? `${manifest.modelName} publishes no usable gust speed.`
              : `${manifest?.modelName ?? "This model"} publishes window maxima.`}{" "}
          Neither kind is a continuous measurement.
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
        {!!point.locationSources?.length && (
          <div className="location-sources">
            <strong>Selected location sources</strong>
            {point.locationSources.map((source) => (
              <p key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer">
                  {source.name}
                </a>
                {" · "}
                {source.licence}
              </p>
            ))}
          </div>
        )}
        <p className="location-attribution">
          Location directory: contains Irish Public Sector Data from{" "}
          <a
            href="https://data.gov.ie/ga/dataset/tourism-activities-and-attractions/resource/7a6245fd-d07a-4b2f-82a7-19373eb648b6"
            target="_blank"
            rel="noreferrer"
          >
            Fáilte Ireland
          </a>{" "}
          under{" "}
          <a
            href="https://creativecommons.org/licenses/by/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY 4.0
          </a>
          ;{" "}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            © OpenStreetMap contributors (ODbL)
          </a>
          ; and individually linked web references. The public layer shows
          riding-location references, not business listings. Source-listed
          locations are not verified launches.
        </p>
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
