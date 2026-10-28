import { useId, type ReactNode } from "react";
import { MODELS, type ModelId } from "../force5/src/models";
import {
  SATELLITE_LABEL,
  SATELLITE_TIDES_NOTE,
  satelliteTidesLine,
} from "../force5/src/satellite";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { InfoButton } from "./InfoPop";
import { KnotScale } from "./KnotScale";
import { RainScale } from "./RainScale";
import { Cutting, CuttingDefs } from "./layerCuttings";
import {
  defaultLayersLine,
  isDefaultLayers,
  layerGroups,
  type LayerChoices,
  type LayerGroup,
  type LayerTile as Tile,
} from "./layerGroups";
import type { InfoSection } from "./mapInfoContext";
import "./layers.css";

export interface LayersPanelProps extends LayerChoices {
  /** False while it fades out after closing (ui/Backdrop.tsx `useFadeOut`). */
  open: boolean;
  onClose: () => void;
  /** The map's information, at a layer's own part from its "i". */
  onInfo: (at: InfoSection) => void;
  /** The images' tides at the station nearest the map's centre, once known. */
  satelliteTides: { name: string; high: number; low: number } | null;
  /** The chosen image's tiles are still coming in. */
  satelliteLoading: boolean;
  model: string | undefined;
  /** Why the map draws no wind at the hour shown, or null when it does. */
  modelNote: string | null;
  modelDisabled: boolean;
  onModel: (id: ModelId) => void;
  /** What the Currents layer cannot draw at the hour shown, while it is on. */
  currentsNote: string | null;
  /** Why the tidal depth is not drawn, while it is on: the chart is out too far. */
  foilNote: string | null;
  /** Back to the defaults (src/layerGroups.tsx `LAYER_DEFAULTS`). */
  onReset: () => void;
}

/** A group of tiles, and under them a scale or what a layer cannot draw. */
type Group = LayerGroup & { foot?: ReactNode };

function TileButton({
  tile,
  onInfo,
}: {
  tile: Tile;
  onInfo: (at: InfoSection) => void;
}) {
  const subId = useId();
  return (
    <div className="lp-tile">
      {/* A toggle: "worded", for the tile says it is on itself (the second
          rule round its picture, ON, the name in bold) and keeps no fill. */}
      <Button
        className="lp-press"
        pressed={tile.on ? "worded" : false}
        aria-describedby={subId}
        data-layer={tile.layer}
        onClick={tile.press}
      >
        <span className="lp-cut">
          <Cutting id={tile.cut} />
          {tile.glyph && <span className="lp-badge">{tile.glyph}</span>}
          <span className="lp-on" aria-hidden="true">
            On
          </span>
        </span>
        <span className="lp-name">
          {tile.name}
          {tile.isNew && (
            <span className="lp-new" aria-hidden="true">
              New
            </span>
          )}
        </span>
        <small id={subId} className="lp-sub" aria-hidden="true">
          {tile.sub}
        </small>
      </Button>
      {tile.info && (
        <InfoButton
          label={tile.info.label}
          onOpen={() => onInfo(tile.info!.at)}
        />
      )}
    </div>
  );
}

function TileGroup({
  group,
  onInfo,
}: {
  group: Group;
  onInfo: (at: InfoSection) => void;
}) {
  const headId = useId();
  return (
    <section className="lp-group">
      <header className="lp-head">
        <h3 id={headId}>
          {group.glyph}
          {group.name}
        </h3>
        <span className="lp-rule">{group.rule}</span>
      </header>
      <div className="lp-tiles" role="group" aria-labelledby={headId}>
        {group.tiles.map((tile) => (
          <TileButton key={tile.id} tile={tile} onInfo={onInfo} />
        ))}
      </div>
      {group.foot}
    </section>
  );
}

/**
 * The Layers panel: every layer the chart can draw, as a tile with a picture
 * of it (src/layerCuttings.tsx), under ruled headings: the wind, the sea, the
 * chart, the ground under it, and what is drawn round the chosen spot; then
 * which model draws the wind. Each tile is a toggle button, and the layers,
 * their groups and how each group's switches combine are src/layerGroups.tsx,
 * which the desktop's layers' rail (src/LayerRail.tsx) draws from too.
 *
 * Opened from the site menu, and from Layers under the zoom and in the dock
 * where there is no room for the rail (src/MapControls.tsx), and only then
 * loaded: this file, its pictures and its stylesheet are a chunk of their
 * own. On a phone the dialog is a modal in the middle of the screen, three
 * tiles across.
 */
export default function LayersPanel({
  open,
  onClose,
  onInfo,
  wind,
  onWind,
  layers,
  onLayersChange,
  satellite,
  onSatellite,
  satelliteTides,
  satelliteLoading,
  focusStyle,
  onFocusStyle,
  model,
  modelNote,
  modelDisabled,
  onModel,
  currentsNote,
  foilNote,
  onReset,
}: LayersPanelProps) {
  // Under the tiles: what the colours mean while the wind is drawn in them,
  // and what a layer that is on cannot draw.
  const foot: Partial<Record<LayerGroup["id"], ReactNode>> = {
    wind: wind.wash && <KnotScale />,
    sea: ((layers.foil && foilNote) || layers.currents) && (
      <>
        {layers.foil && foilNote && (
          <p className="lp-note">
            <b>Tidal depth:</b> <span data-foil-note>{foilNote}</span>
          </p>
        )}
        {layers.currents && (
          <p className="lp-note">
            <b>Currents:</b>{" "}
            <span data-currents-note>{currentsNote ?? "Not for safety."}</span>
          </p>
        )}
      </>
    ),
    weather: layers.rain && (
      <>
        <RainScale />
        <p className="lp-note">
          <b>Rain:</b> ICON-EU, hourly, for three days.
        </p>
      </>
    ),
    ground: satellite !== "off" && (satelliteLoading || satelliteTides) && (
      <div className="lp-note">
        {satelliteLoading && (
          <small role="status" data-satellite-loading>
            Loading the {SATELLITE_LABEL[satellite].toLowerCase()} image…
          </small>
        )}
        {satelliteTides && (
          <>
            <small data-satellite-tides>
              {satelliteTidesLine(satelliteTides)}
            </small>
            <small>{SATELLITE_TIDES_NOTE}</small>
          </>
        )}
      </div>
    ),
  };
  const groups: Group[] = layerGroups({
    wind,
    onWind,
    layers,
    onLayersChange,
    satellite,
    onSatellite,
    focusStyle,
    onFocusStyle,
  }).map((group) => ({ ...group, foot: foot[group.id] }));

  return (
    <Dialog
      open={open}
      title="Layers"
      className="map-panel-dialog layers-dialog"
      onClose={onClose}
      actions={
        <>
          {/* The defaults by name, from the layers themselves: as what is
              on while the chart is at them, else as what Reset puts back. */}
          <span className="lp-default" data-layers-default>
            {defaultLayersLine(
              isDefaultLayers({ wind, layers, satellite, focusStyle }),
            )}
          </span>
          <Button variant="quiet" size="sm" onClick={onReset}>
            Reset
          </Button>
        </>
      }
    >
      <div id="map-layers" className="lp" role="group" aria-label="Layers">
        <CuttingDefs />
        {groups.map((group) => (
          <TileGroup key={group.name} group={group} onInfo={onInfo} />
        ))}
        <section className="lp-group">
          <header className="lp-head">
            <h3>Model, for the map and the stars</h3>
            <span className="lp-rule">ECMWF past its run</span>
          </header>
          {modelNote && <p className="models-note">{modelNote}</p>}
          <div className="lp-models" role="group" aria-label="Weather model">
            {MODELS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-model={entry.id}
                aria-label={`Use ${entry.name} model`}
                aria-pressed={model === entry.id}
                disabled={modelDisabled}
                onClick={() => onModel(entry.id)}
              >
                <span>{entry.name}</span>
                <small>{entry.detail}</small>
              </button>
            ))}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
