/**
 * The opening film: flat evening water, an island, cliffs, and thirteen wing
 * foilers riding into the sunset. See camera.ts for the shot list and
 * fleet.ts for who is on the water.
 *
 * Rendered HDR and linear throughout: the sky (Preetham, with three's cloud
 * layer), the planar-mirror water and the riders all light from the same sun,
 * the environment light is the sky itself prefiltered, and the haze colours
 * are read back from the rendered sky so the land dissolves into the air
 * exactly. Bloom, ACES tone mapping, a vignette and a little grain finish it.
 */
import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FloatType,
  Group,
  HalfFloatType,
  MathUtils,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { Sky } from "three/addons/objects/Sky.js";
import { gradeShader, MotionBlurPass, SceneRenderPass, ShaftPass } from "./post";
import { cameraPath, sunDirection, sunElevation, SUN_AZIMUTH } from "./camera";
import {
  centroidOf,
  fleet,
  planSquall,
  REVIEW_SEED,
  sampleMotion,
  sampleTrack,
  simulateFleet,
} from "./fleet";
import { WIND } from "./gust";
import { hazeUniforms } from "./haze";
import { buildRider, canopyUniforms } from "./rider";
import { createTerrain } from "./terrain";
import { createWakes } from "./wakes";
import { createWater } from "./water";

export interface IntroOptions {
  /** Called every frame with the film's clock, in seconds, and the camera's height. */
  onTime?: (t: number, cameraHeight: number) => void;
  /** Called once the first frame is on screen. */
  onReady?: () => void;
  /** Start part-way in (for review): seconds. */
  startAt?: number;
  /** Hold the clock where it starts (for review and screenshots). */
  frozen?: boolean;
  /**
   * Who rides and how, and where the squall falls: each showing passes its
   * own, so no two are quite alike. Review uses REVIEW_SEED.
   */
  seed?: number;
}

export interface IntroHandle {
  dispose(): void;
  /** Jump the film's clock, seconds (for review). */
  seek(t: number): void;
}

/** The haze: thin enough to keep the island, thick enough to lose the mountains. */
const HAZE_DENSITY = 0.00009;
const EXPOSURE = 0.56;
const BLOOM = 0.22;

export async function startIntro(
  canvas: HTMLCanvasElement,
  options: IntroOptions = {},
): Promise<IntroHandle> {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    powerPreference: "high-performance",
    stencil: false,
  });
  let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;

  const width = () => canvas.clientWidth || window.innerWidth;
  const height = () => canvas.clientHeight || window.innerHeight;
  renderer.setSize(width(), height(), false);

  const scene = new Scene();
  const camera = new PerspectiveCamera(44, width() / height(), 0.1, 30000);
  camera.rotation.order = "YXZ";

  // ---- sky and sun ----
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const skyU = sky.material.uniforms;
  // Clean Atlantic air: little turbidity keeps the glow round the sun tight,
  // and a strong Rayleigh term does the reddening along the horizon.
  skyU.turbidity.value = 4.2;
  skyU.rayleigh.value = 2.8;
  skyU.mieCoefficient.value = 0.003;
  skyU.mieDirectionalG.value = 0.88;
  skyU.cloudCoverage.value = 0.46;
  skyU.cloudDensity.value = 0.62;
  skyU.cloudScale.value = 0.00022;
  skyU.cloudSpeed.value = 0.00003;
  skyU.cloudElevation.value = 0.55;
  scene.add(sky);

  const sun = new Vector3();
  const sunColor = new Color();
  const light = new DirectionalLight(0xffffff, 3);
  scene.add(light, light.target);

  // A second sky for reading colours back and for the environment light.
  const skyScene = new Scene();
  const skyProbe = new Sky();
  skyProbe.scale.setScalar(1000);
  skyProbe.material.uniforms = skyU; // shares every parameter
  skyScene.add(skyProbe);
  const pmrem = new PMREMGenerator(renderer);
  let envTarget: WebGLRenderTarget | null = null;
  const probeTarget = new WebGLRenderTarget(4, 4, { type: FloatType });
  const probeCamera = new PerspectiveCamera(2, 1, 1, 2000);
  probeCamera.rotation.order = "YXZ";
  const probePixels = new Float32Array(4 * 4 * 4);

  const readSky = (yawDeg: number, pitchDeg: number, out: Color) => {
    probeCamera.rotation.set(MathUtils.degToRad(pitchDeg), MathUtils.degToRad(yawDeg), 0);
    probeCamera.updateMatrixWorld();
    renderer.setRenderTarget(probeTarget);
    renderer.render(skyScene, probeCamera);
    renderer.readRenderTargetPixels(probeTarget, 0, 0, 4, 4, probePixels);
    renderer.setRenderTarget(null);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < 16; i++) {
      r += probePixels[i * 4];
      g += probePixels[i * 4 + 1];
      b += probePixels[i * 4 + 2];
    }
    return out.setRGB(r / 16, g / 16, b / 16);
  };

  const hazeBase = new Color();
  const hazeSun = new Color();
  const foam = new Color();
  const skyTop = new Color();
  const sunYawDeg = -MathUtils.radToDeg(SUN_AZIMUTH);

  const aimSun = (t: number) => {
    sunDirection(t, sun);
    skyU.sunPosition.value.copy(sun).multiplyScalar(450000);
  };

  /**
   * The sky's colours where the haze, the water and the foam need them,
   * read back from the rendered sky every few seconds of the film, all at
   * load: reading a GPU target back stalls the pipeline, and doing it during
   * the film was a visible hitch each time.
   */
  const LIGHT_STEP = 3;
  const lightTable: { base: Color; toSun: Color; top: Color }[] = [];
  skyU.showSunDisc.value = 0;
  for (let t = 0; t <= 48; t += LIGHT_STEP) {
    aimSun(t);
    lightTable.push({
      base: readSky(16, 0.6, new Color()).multiplyScalar(0.8),
      toSun: readSky(sunYawDeg + 14, 0.5, new Color()).multiplyScalar(0.8),
      top: readSky(sunYawDeg + 180, 60, new Color()),
    });
  }
  // The environment light, once: the sun moves two degrees in the whole film.
  aimSun(options.startAt ?? 12);
  envTarget = pmrem.fromScene(skyScene, 0, 1, 2000);
  scene.environment = envTarget.texture;
  skyU.showSunDisc.value = 1;

  /** Re-light everything from the sun's current height. Cheap: every frame. */
  const relight = (t: number) => {
    aimSun(t);
    const e = sunElevation(t);
    // The low sun through a long path of air: orange, and weaker as it sinks.
    sunColor
      .setRGB(1, 0.36, 0.12)
      .lerp(new Color(1, 0.62, 0.36), MathUtils.smoothstep(e, 0, 9))
      .multiplyScalar(MathUtils.lerp(2.2, 3.6, MathUtils.smoothstep(e, 0, 6)));
    light.color.copy(sunColor);
    light.intensity = 1;

    // The air is a shade darker than the sky behind it (the 0.8 above), or
    // land turns to sky.
    const f = Math.min(Math.max(t, 0) / LIGHT_STEP, lightTable.length - 1.001);
    const i = Math.floor(f);
    const a = lightTable[i];
    const b = lightTable[i + 1];
    hazeBase.copy(a.base).lerp(b.base, f - i);
    hazeSun.copy(a.toSun).lerp(b.toSun, f - i);
    skyTop.copy(a.top).lerp(b.top, f - i);
    hazeUniforms.hazeBase.value.copy(hazeBase);
    hazeUniforms.hazeSun.value.copy(hazeSun);
    hazeUniforms.hazeDensity.value = HAZE_DENSITY;
    hazeUniforms.hazeSunDir.value.copy(sun);
    water.setHaze(hazeBase, hazeSun, HAZE_DENSITY);
    water.setSkyLight(skyTop);
    // Foam is white lit by the whole sky, with a little of the sun on it.
    const sky = (hazeBase.r + hazeBase.g + hazeBase.b) / 3;
    foam.setRGB(0.9, 0.93, 0.97).multiplyScalar(sky * 1.6).add(new Color().copy(sunColor).multiplyScalar(0.08));
    canopyUniforms.sunTransmit.value.copy(sunColor).multiplyScalar(0.85);
  };
  scene.environmentIntensity = 0.7;

  // ---- the world ----
  const water = createWater({
    wind: WIND,
    reflectionScale: 0.6,
    width: width() * pixelRatio,
    height: height() * pixelRatio,
  });
  scene.add(water.mesh);
  scene.add(createTerrain());

  const seed = options.seed ?? REVIEW_SEED;
  const specs = fleet(seed);
  const DURATION = 150;
  // Ride it once in the patchwork alone to see where the fleet will be, then
  // again with the squall planned to come through it there.
  const squall = planSquall(seed, centroidOf(simulateFleet(specs, 30)));
  const tracks = simulateFleet(specs, DURATION, squall);
  const riders: Group[] = specs.map((spec) => {
    const r = buildRider(spec.look, spec.pose);
    scene.add(r);
    return r;
  });
  const wakes = createWakes(tracks);
  scene.add(wakes.wake, wakes.spray);
  water.hideFromReflection.push(wakes.wake, wakes.spray);

  const path = cameraPath(tracks);
  riders.forEach((r) => r.traverse((m) => (m.userData.moves = true)));
  // The water as the velocity pass sees it: a plain sheet, so the mirror is
  // not rendered a second time just to say the water stands still.
  const waterProxy = new Mesh(new PlaneGeometry(40000, 40000), new MeshBasicMaterial());
  waterProxy.rotation.x = -Math.PI / 2;
  scene.add(waterProxy);

  // ---- post ----
  const composerTarget = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  const composer = new EffectComposer(renderer, composerTarget);
  composer.addPass(new SceneRenderPass(scene, camera));
  const motion = new MotionBlurPass(scene, camera, [sky, water.mesh, wakes.wake, wakes.spray], [waterProxy]);
  composer.addPass(motion);
  const shafts = new ShaftPass();
  composer.addPass(shafts);
  // Only what is truly bright blooms: the sun, its glitter, a backlit wing.
  const bloom = new UnrealBloomPass(new Vector2(width(), height()), BLOOM, 0.4, 2.4);
  // Bloom is a wide blur; at half resolution it looks the same and costs a
  // quarter (it was the single most expensive pass at full size).
  const bloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w: number, h: number) => bloomSize(Math.ceil(w / 2), Math.ceil(h / 2));
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(gradeShader);
  composer.addPass(grade);

  const resize = () => {
    const w = width();
    const h = height();
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    water.resize(w * pixelRatio, h * pixelRatio);
    grade.uniforms.resolution.value.set(w * pixelRatio, h * pixelRatio);
  };
  resize();
  window.addEventListener("resize", resize);

  // ---- frame ----
  const p = new Vector3();
  let filmTime = options.startAt ?? 0;
  const debug: { look?: { from: Vector3; at: Vector3 } } = {};
  /** Where the camera and every rider are at film time t. */
  const pose = (t: number) => {
    const cam = path(t);
    camera.position.copy(cam.position);
    camera.rotation.set(
      MathUtils.degToRad(cam.pitch),
      MathUtils.degToRad(cam.yaw),
      MathUtils.degToRad(cam.roll),
    );
    if (debug.look) {
      camera.position.copy(debug.look.from);
      camera.lookAt(debug.look.at);
    }
    // Auto-exposure, as a real camera would: looking down at dark water it
    // opens up, looking at the sunset it stops down.
    renderer.toneMappingExposure =
      EXPOSURE * MathUtils.lerp(1, 3.8, MathUtils.smoothstep(-cam.pitch, 12, 70));
    if (camera.fov !== cam.fov) {
      camera.fov = cam.fov;
      camera.updateProjectionMatrix();
    }
    camera.updateMatrixWorld();
    waterProxy.position.set(camera.position.x, 0, camera.position.z);

    specs.forEach((spec, i) => {
      const heading = sampleTrack(tracks[i], t, p);
      const r = riders[i];
      const ph = spec.phase;
      r.position.set(
        p.x,
        0.022 * Math.sin(t * 3.1 + ph) + 0.012 * Math.sin(t * 5.3 + ph * 2),
        p.z,
      );
      // Leaning into each carve as hard as the speed and the turn ask
      // (tan bank = v w / g), pitching with the pumping of the foil.
      const { speed, turn } = sampleMotion(tracks[i], t);
      const bank = MathUtils.clamp(Math.atan((speed * turn) / 9.81), -0.4, 0.4);
      r.rotation.set(
        0.012 * Math.sin(t * 2.3 + ph),
        -heading,
        -bank + 0.01 * Math.sin(t * 1.7 + ph),
        "YXZ",
      );
    });
  };

  /** A 1/40 s shutter: a touch longer than film's 180 degrees, for speed. */
  const SHUTTER = 1 / 40;
  const sunFar = new Vector3();
  const place = (t: number) => {
    pose(Math.max(0, t - SHUTTER));
    motion.capturePrevious();
    pose(t);
    relight(t);
    // Keep the sun's shadow-free key light pointing the right way.
    light.position.copy(camera.position).addScaledVector(sun, 100);
    light.target.position.copy(camera.position);

    sunFar.copy(camera.position).addScaledVector(sun, 10000);
    const finale = MathUtils.smoothstep(t, 20, 26);
    shafts.update(sunFar, camera, camera.aspect, MathUtils.lerp(0.18, 0.7, finale));
    const s = sunFar.clone().project(camera);
    grade.uniforms.sunUv.value.set(s.x * 0.5 + 0.5, s.y * 0.5 + 0.5);
    const onScreen = Math.abs(s.x) < 1.1 && Math.abs(s.y) < 1.1 && s.z < 1;
    grade.uniforms.flare.value = onScreen ? finale : 0;
    // Stop down with the sun in the frame, as a camera's meter would: the sky
    // keeps its colour and everything in front of the sun goes to silhouette.
    const inFrame = s.z < 1 ? 1 - MathUtils.smoothstep(Math.max(Math.abs(s.x), Math.abs(s.y)), 0.7, 1.3) : 0;
    // Hardest on the water, where a rider crossing the sun should be a black
    // shape against orange sky rather than lost in white glare.
    const skimming = 1 - MathUtils.smoothstep(t, 14, 16);
    renderer.toneMappingExposure *= MathUtils.lerp(1, MathUtils.lerp(0.7, 0.38, skimming), inFrame);
    // And a smaller halo, so the sun outlines the rider instead of eating them.
    bloom.strength = MathUtils.lerp(BLOOM, 0.06, inFrame * skimming);

    water.update(t, camera, sun, sunColor);
    water.setSquall(squall, t);
    wakes.update(t, foam, (height() * pixelRatio) / (2 * Math.tan(MathUtils.degToRad(camera.fov / 2))));
    canopyUniforms.sunDirView.value.copy(sun).transformDirection(camera.matrixWorldInverse);
    skyU.time.value = t;
    grade.uniforms.time.value = t;
    grade.uniforms.fade.value = MathUtils.smoothstep(t, 0, 1.6);
  };

  // A handle for poking at the film from the console, under the dev server only.
  if (import.meta.env.DEV)
    (window as unknown as { __intro: unknown }).__intro = { scene, camera, composer, bloom, renderer, place, debug, riders, Vector3, motion, shafts, water, grade };

  place(filmTime);
  // Compile every shader before the clock starts, so the first seconds don't stutter.
  await renderer.compileAsync(scene, camera);
  composer.render();
  options.onReady?.();

  let running = true;
  let previous = performance.now();
  let frames = 0;
  let slowFrames = 0;
  const loop = (now: number) => {
    if (!running) return;
    const dt = Math.min(0.1, (now - previous) / 1000);
    previous = now;
    if (!options.frozen) filmTime += dt;

    // A machine that cannot keep up drops to a lower resolution once, early.
    frames++;
    if (frames > 20 && frames < 140 && dt > 1 / 38) slowFrames++;
    if (frames === 140 && slowFrames > 50 && pixelRatio > 1) {
      pixelRatio = 1;
      resize();
    }

    place(filmTime);
    composer.render();
    options.onTime?.(filmTime, camera.position.y);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    seek(t: number) {
      filmTime = t;
    },
    dispose() {
      running = false;
      window.removeEventListener("resize", resize);
      water.dispose();
      wakes.dispose();
      envTarget?.dispose();
      pmrem.dispose();
      probeTarget.dispose();
      composerTarget.dispose();
      composer.dispose();
      scene.traverse((o) => {
        const mesh = o as { geometry?: { dispose(): void } };
        mesh.geometry?.dispose();
      });
      renderer.dispose();
    },
  };
}


