/**
 * The chart itself: MapLibre Native drawing the site's Admiralty style
 * (mapStyle.ts), and over its lines, every one a native layer on the GPU,
 * the satellite image, the foilable depth at the tide, the wind's wash or
 * arrows, the quiet round a focused spot, the spot lights, the tapped
 * point's pen mark and the rider's own position.
 *
 * The chart's own layers (the depths, the names) are in the style; their
 * switches and the focus's quietening are written onto them by `<Layer>`s
 * with the same ids, which MapLibre React Native applies to the layer
 * already there. Those stay mounted: unmounting one would take the style's
 * layer away with it.
 */
import {
  Camera,
  GeoJSONSource,
  ImageSource,
  Images,
  Layer,
  Map,
  RasterDEMSource,
  RasterSource,
  type CameraRef,
  type LayerProps,
  type MapRef,
  type ViewStateChangeEvent,
} from "@maplibre/maplibre-react-native";
import type { FeatureCollection, Point } from "geojson";
import { memo, useMemo, type Ref } from "react";
import { StyleSheet, View, type NativeSyntheticEvent } from "react-native";
import { CHART_LAYERS, CHART_MIN_ZOOM, PLACE_CLASSES } from "../../../../force5/src/chartStyle";
import { colors } from "../../theme/tokens";
import type { FoilLayer } from "./foilLogic";
import { labelLayers, lightLayers, wedgeLayer, type LightProps } from "./lightsLogic";
import { CHART_PAN_BOUNDS, focusFeatures, IRELAND_BOUNDS, type MapLayers } from "./mapLogic";
import { appChartStyle } from "./mapStyle";
import { chartIcons } from "./sdfIcons";
import type { SatelliteLayer } from "./useChartLayers";
import type { Wash } from "./useWind";
import { DEPTHS_ZOOM, WASH_FADE, type ArrowProps } from "./windLogic";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };
const asLayer = (spec: object) => spec as LayerProps;

export interface FocusMark {
  lon: number;
  lat: number;
  /** The quiet's radius in metres. */
  radius: number;
}

interface Props {
  mapRef: Ref<MapRef>;
  cameraRef: Ref<CameraRef>;
  /** Room the sheet and the head take, in points, for the opening fit. */
  padding: { top: number; bottom: number; left: number; right: number };
  layers: MapLayers;
  lights: FeatureCollection<Point, LightProps>;
  wedge: FeatureCollection;
  arrows: FeatureCollection<Point, ArrowProps> | null;
  /** The arrows in ink (reduced motion's stand-in for the lines), else on the rider's scale. */
  arrowsInk: boolean;
  wash: Wash | null;
  satellite: readonly (SatelliteLayer & { visible: boolean })[];
  foil: readonly (FoilLayer & { visible: boolean })[];
  focus: FocusMark | null;
  picked: { lon: number; lat: number } | null;
  me: { lon: number; lat: number } | null;
  onLight: (id: string) => void;
  onPick: (lon: number, lat: number, x: number, y: number) => void;
  onMoving: () => void;
  onIdle: (event: ViewStateChangeEvent) => void;
  onReady: () => void;
}

/** The style's own layers, with what the panel and the focus write onto them. */
function ChartOverrides({ layers, focus }: { layers: MapLayers; focus: FocusMark | null }) {
  const visible = (on: boolean) => (on ? "visible" : "none") as "visible" | "none";
  const near = useMemo(
    () =>
      focus
        ? [
            "all",
            PLACE_CLASSES,
            ["within", { type: "Polygon", coordinates: [focusFeatures(focus.lon, focus.lat, focus.radius * 1.4).features[0].geometry.coordinates[1]] }],
          ]
        : PLACE_CLASSES,
    [focus],
  );
  const own = (id: string, type: string, sourceLayer: string, extra: object) =>
    asLayer({ id, type, source: "bathy", "source-layer": sourceLayer, ...extra });
  return (
    <>
      {CHART_LAYERS.tints.map((id) => (
        <Layer key={id} {...own(id, "fill", "bands", { layout: { visibility: visible(layers.tints) } })} />
      ))}
      <Layer {...own("contours", "line", "contours", { layout: { visibility: visible(layers.soundings) } })} />
      <Layer {...own("contours-dashed", "line", "contours", { layout: { visibility: visible(layers.soundings) } })} />
      <Layer {...own("contour-labels", "symbol", "contours", { layout: { visibility: visible(layers.soundings) } })} />
      <Layer {...own("soundings", "symbol", "soundings", { layout: { visibility: visible(layers.soundings) } })} />
      <Layer {...own("relief", "line", "relief", { layout: { visibility: visible(layers.relief) } })} />
      <Layer
        {...asLayer({
          id: "places",
          type: "symbol",
          source: "omt",
          "source-layer": "place",
          paint: { "text-opacity": focus ? 0.3 : 0.8 },
        })}
      />
      <Layer
        {...asLayer({
          id: "water-names",
          type: "symbol",
          source: "omt",
          "source-layer": "water_name",
          paint: { "text-opacity": focus ? 0.35 : 1 },
        })}
      />
      <Layer
        {...asLayer({
          id: "places-near",
          type: "symbol",
          source: "omt",
          "source-layer": "place",
          filter: near,
          layout: { visibility: visible(!!focus) },
        })}
      />
    </>
  );
}

export const ChartMap = memo(function ChartMap({
  mapRef,
  cameraRef,
  padding,
  layers,
  lights,
  wedge,
  arrows,
  arrowsInk,
  wash,
  satellite,
  foil,
  focus,
  picked,
  me,
  onLight,
  onPick,
  onMoving,
  onIdle,
  onReady,
}: Props) {
  const icons = useMemo(() => chartIcons(), []);
  const style = useMemo(() => appChartStyle(), []);
  const lightSpecs = useMemo(() => lightLayers("lights"), []);
  const labelSpecs = useMemo(
    () => labelLayers("lights", { names: layers.names, focused: !!focus }),
    [layers.names, focus],
  );
  const focusData = useMemo(
    () => (focus ? focusFeatures(focus.lon, focus.lat, focus.radius) : EMPTY),
    [focus],
  );

  return (
    <View
      style={StyleSheet.absoluteFill}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Chart of Ireland's coast with the wing foil forecast"
    >
      <Map
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={style}
        touchRotate={false}
        touchPitch={false}
        compass={false}
        logo={false}
        attribution={false}
        scaleBar={false}
        tintColor={colors.ink}
        onPress={(event) => {
          const { lngLat, point } = event.nativeEvent;
          onPick(lngLat[0], lngLat[1], point[0], point[1]);
        }}
        onRegionWillChange={() => onMoving()}
        onRegionDidChange={(event: NativeSyntheticEvent<ViewStateChangeEvent>) => onIdle(event.nativeEvent)}
        onDidFinishLoadingMap={() => onReady()}
      >
        <Camera
          ref={cameraRef}
          initialViewState={{ bounds: IRELAND_BOUNDS, padding: padding }}
          minZoom={CHART_MIN_ZOOM}
          maxZoom={14}
          maxBounds={CHART_PAN_BOUNDS}
        />
        <Images images={icons} />
        <ChartOverrides layers={layers} focus={focus} />

        {/* Under the chart's lines: the satellite, then the foilable depth. */}
        {satellite.map((s) => (
          <RasterSource key={s.id} id={s.id} url={s.url} tileSize={s.tileSize} attribution={s.attribution}>
            <Layer
              {...asLayer({
                id: s.id,
                type: "raster",
                beforeId: wash ? "wind-wash" : "relief",
                minzoom: Math.max(0, s.minzoom - 0.5),
                layout: { visibility: s.visible ? "visible" : "none" },
                paint: { "raster-opacity": 0.92, "raster-fade-duration": 150 },
              })}
            />
          </RasterSource>
        ))}
        {foil.map((f) => (
          <RasterDEMSource
            key={f.id}
            id={f.id}
            url={f.url}
            encoding="terrarium"
            tileSize={f.tileSize}
            attribution={f.attribution}
          >
            <Layer
              {...asLayer({
                id: f.id,
                type: "color-relief",
                beforeId: "rivers",
                minzoom: Math.max(0, f.minzoom - 0.5),
                layout: { visibility: f.visible ? "visible" : "none" },
                // The ramp's colours carry their own alpha (ui/theme.css). The
                // heights are sampled linearly, as on the site: the build pads
                // the land beside the water so nothing sweeps the ramp.
                paint: { "color-relief-color": f.color, "color-relief-opacity": 1 },
              })}
            />
          </RasterDEMSource>
        ))}

        {wash && (
          <ImageSource id="wind-wash" url={wash.uri} coordinates={wash.coordinates}>
            <Layer
              {...asLayer({
                id: "wind-wash",
                type: "raster",
                beforeId: "relief",
                paint: {
                  "raster-opacity": ["interpolate", ["linear"], ["zoom"], DEPTHS_ZOOM - WASH_FADE, 1, DEPTHS_ZOOM, 0],
                  "raster-fade-duration": 0,
                  "raster-resampling": "linear",
                },
              })}
            />
          </ImageSource>
        )}

        {/* The quiet round a focus: paper over the depths and the coast, under the names. */}
        <GeoJSONSource id="focus" data={focusData}>
          <Layer
            {...asLayer({
              id: "focus",
              type: "fill",
              beforeId: wash ? "wind-wash" : "water-names",
              paint: { "fill-color": colors.paper, "fill-opacity": focus ? 0.26 : 0, "fill-opacity-transition": { duration: 450, delay: 0 } },
            })}
          />
        </GeoJSONSource>

        <GeoJSONSource id="wind-arrows" data={arrows ?? EMPTY}>
          <Layer
            {...asLayer({
              id: "wind-arrows",
              type: "symbol",
              beforeId: "lt-wedge",
              layout: {
                visibility: arrows ? "visible" : "none",
                "icon-image": "wind-arrow",
                "icon-rotate": ["get", "rot"],
                "icon-rotation-alignment": "map",
                "icon-size": ["interpolate", ["linear"], ["get", "kn"], 3, 0.7, 15, 0.95, 30, 1.2],
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
              },
              paint: {
                // Zoomed right in the depths take over: the colours go to ink (windLayer.ts).
                "icon-color": arrowsInk ? colors.ink : ["step", ["zoom"], ["get", "c"], DEPTHS_ZOOM, colors.ink],
                "icon-opacity": arrowsInk ? 0.55 : 0.9,
              },
            })}
          />
        </GeoJSONSource>

        {/* The lights, over everything on the chart. */}
        <GeoJSONSource id="lt-wedge-src" data={wedge}>
          <Layer {...asLayer(wedgeLayer("lt-wedge-src"))} />
        </GeoJSONSource>
        <GeoJSONSource
          id="lights"
          data={lights}
          hitbox={{ top: 22, bottom: 22, left: 22, right: 22 }}
          onPress={(event) => {
            const id = event.nativeEvent.features?.[0]?.properties?.id;
            if (typeof id === "string") {
              event.stopPropagation();
              onLight(id);
            }
          }}
        >
          {lightSpecs.map((spec) => (
            <Layer key={spec.id} {...asLayer(spec)} />
          ))}
          {labelSpecs.map((spec) => (
            <Layer key={spec.id} {...asLayer(spec)} />
          ))}
        </GeoJSONSource>

        <GeoJSONSource
          id="picked"
          data={
            picked
              ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [picked.lon, picked.lat] } }
              : EMPTY
          }
        >
          <Layer
            {...asLayer({
              id: "picked-mark",
              type: "symbol",
              layout: { "icon-image": "pick-mark", "icon-allow-overlap": true, "icon-ignore-placement": true },
              paint: { "icon-color": colors.ink, "icon-halo-color": colors.paper, "icon-halo-width": 1.5 },
            })}
          />
          <Layer
            {...asLayer({
              id: "picked-loop",
              type: "symbol",
              layout: { "icon-image": "pen-loop", "icon-allow-overlap": true, "icon-ignore-placement": true },
              paint: { "icon-color": colors.pen, "icon-opacity": 0.88 },
            })}
          />
        </GeoJSONSource>

        <GeoJSONSource
          id="me"
          data={
            me
              ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [me.lon, me.lat] } }
              : EMPTY
          }
        >
          <Layer
            {...asLayer({
              id: "me",
              type: "circle",
              paint: {
                "circle-radius": 5.5,
                "circle-color": colors.now,
                "circle-stroke-color": colors.paper,
                "circle-stroke-width": 2,
              },
            })}
          />
        </GeoJSONSource>
      </Map>
    </View>
  );
});
