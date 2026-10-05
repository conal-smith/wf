/**
 * Flat water in a breeze: no swell, only wind ripples, and the darker patches
 * of stronger air (cat's paws) drifting downwind across glassy lanes between
 * them. That patchwork is how a sailor reads wind on calm water, so it is what
 * says "there is wind here" without a single wave.
 *
 * A planar mirror (three's Reflector) renders the scene upside down into a
 * texture; this shader then mixes that reflection with the water's own colour
 * by Fresnel, wobbles it by the ripple normal, and adds the sun's glitter.
 * Every ripple is an analytic sine whose slope is known exactly, and each one
 * fades out once a pixel covers more than a fraction of its wavelength, so the
 * water stays crisp near the lens and calm (not shimmering) at the horizon.
 */
import {
  Color,
  PlaneGeometry,
  Vector2,
  Vector3,
  Vector4,
  type Camera,
  type Object3D,
  type Scene,
  type WebGLRenderer,
} from "three";
import { Reflector } from "three/addons/objects/Reflector.js";
import { GUST_GLSL, type Squall, squallAt } from "./gust";
import { seeded } from "./random";

const WAVES = 28;

export interface WaterOptions {
  /** Direction the wind blows towards, on the water plane (x, z). */
  wind: Vector2;
  /** Reflection texture size relative to the drawing buffer. */
  reflectionScale: number;
  width: number;
  height: number;
}

export interface Water {
  mesh: Reflector;
  /** Things drawn on the water (wakes, spray) that must not reflect. */
  hideFromReflection: Object3D[];
  update(time: number, camera: Camera, sun: Vector3, sunColor: Color): void;
  setHaze(base: Color, toSun: Color, density: number): void;
  /** The sky overhead, which lights the water from above. */
  setSkyLight(sky: Color): void;
  /** Where the squall is at time t, and how strong. */
  setSquall(squall: Squall, t: number): void;
  resize(width: number, height: number): void;
  dispose(): void;
}

/**
 * The ripple spectrum: wavelengths spread logarithmically from 4 cm to 3.5 m,
 * pointing within a cone around the wind (wider for the short ones, which the
 * wind tosses about), with a dispersion speed that includes surface tension.
 */
function spectrum(wind: Vector2) {
  const rand = seeded(7);
  const dirs: number[] = [];
  const params: number[] = [];
  const base = Math.atan2(wind.y, wind.x);
  for (let i = 0; i < WAVES; i++) {
    const f = i / (WAVES - 1);
    const lambda = 0.04 * Math.pow(3.5 / 0.04, f) * (0.85 + rand() * 0.3);
    const spread = (0.25 + (1 - f) * 0.75) * (rand() * 2 - 1);
    const angle = base + spread;
    const k = (2 * Math.PI) / lambda;
    // Capillary-gravity dispersion: w^2 = g k + (sigma / rho) k^3.
    const omega = Math.sqrt(9.81 * k + 7.4e-5 * k * k * k);
    // Slope a*k: the short ripples are the steep ones on a breezy flat day.
    const slope = 0.05 + (1 - f) * 0.07;
    const amp = (slope / k) * (0.6 + rand() * 0.8);
    dirs.push(Math.cos(angle), Math.sin(angle));
    params.push(k, omega, amp, rand() * Math.PI * 2);
  }
  return { dirs, params };
}

const vertexShader = /* glsl */ `
  uniform mat4 textureMatrix;
  varying vec4 vMirror;
  varying vec3 vWorld;
  void main() {
    vMirror = textureMatrix * vec4(position, 1.0);
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  #define WAVES ${WAVES}
  uniform vec3 color;
  uniform sampler2D tDiffuse;
  uniform float time;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec2 windDir;
  uniform vec2 waveDir[WAVES];
  uniform vec4 waveParam[WAVES];
  uniform vec3 deepColor;
  uniform vec3 scatterColor;
  uniform vec3 skyLight;
  uniform vec3 hazeBase;
  uniform vec3 hazeSun;
  uniform float hazeDensity;
  varying vec4 vMirror;
  varying vec3 vWorld;

  ${GUST_GLSL}

  void main() {
    vec3 toEye = cameraPosition - vWorld;
    float dist = length(toEye);
    vec3 V = toEye / dist;

    // How many metres one pixel spans here: the grazing direction is the long one.
    vec2 fw = fwidth(vWorld.xz);
    float footprint = max(fw.x, fw.y);

    float gust = gustField(vWorld.xz);
    vec2 grad = vec2(0.0);
    for (int i = 0; i < WAVES; i++) {
      vec4 w = waveParam[i];
      float lambda = 6.2831853 / w.x;
      float keep = smoothstep(1.5 * footprint, 5.0 * footprint, lambda);
      if (keep <= 0.0) continue;
      float phase = w.x * dot(waveDir[i], vWorld.xz) - w.y * time + w.w;
      // Short ripples come and go with the gusts; the long ones carry on.
      float strength = mix(gust, 1.0, clamp(lambda / 3.5, 0.0, 1.0));
      grad += waveDir[i] * (w.z * w.x * cos(phase) * keep * strength);
    }
    // The squall: a ruffled patch racing downwind, the way a sailor sees a
    // gust coming. Its own short chop, where the pixels can hold it.
    float squall = clamp(squallField(vWorld.xz) / 1.8, 0.0, 1.0);
    vec2 chopAt = vWorld.xz * 1.7 - windDir * time * 3.0;
    vec2 chop = vec2(vnoise(chopAt), vnoise(chopAt + 17.3)) - 0.5;
    grad += chop * 0.5 * squall * smoothstep(1.2, 0.25, footprint);
    vec3 N = normalize(vec3(-grad.x, 1.0, -grad.y));

    // Fresnel (Schlick, water F0 = 0.02).
    float cosT = clamp(dot(N, V), 0.0, 1.0);
    float fresnel = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

    // The mirror, nudged by the ripples; less at a distance, where it would smear.
    vec2 nudge = N.xz * (0.002 + 1.6 / (dist + 8.0));
    // Four taps, spread a little by the chop: a softer, steadier mirror
    // without the stair-steps a half-resolution reflection leaves on edges.
    vec2 spread = vec2(0.0012 + 0.0025 * gust, 0.0008) * vMirror.w;
    vec4 m = vMirror + vec4(nudge * vMirror.w, 0.0, 0.0);
    vec3 reflection = 0.25 * (
      texture2DProj(tDiffuse, m + vec4(spread, 0.0, 0.0)).rgb +
      texture2DProj(tDiffuse, m - vec4(spread, 0.0, 0.0)).rgb +
      texture2DProj(tDiffuse, m + vec4(-spread.x, spread.y, 0.0, 0.0)).rgb +
      texture2DProj(tDiffuse, m + vec4(spread.x, -spread.y, 0.0, 0.0)).rgb);

    // The water's own body: dark, lit from above by sky and a little by the sun.
    float sunUp = clamp(sunDir.y * 4.0, 0.0, 1.0);
    vec3 body = deepColor + scatterColor * (sunColor * (0.04 + 0.22 * sunUp) + skyLight * 2.5) * (0.45 + 0.55 * gust);

    // Roughened water tilts facets towards the bright horizon: from above,
    // that sheen is what makes the gusts' dark-and-light patches readable.
    body += hazeBase * clamp((1.0 - N.y) * 30.0, 0.0, 1.0) * 0.05 * gust;
    vec3 col = mix(body, reflection, fresnel);
    // Ruffled water scatters the sky instead of mirroring it: on dark water
    // the gust is a paler, matte patch, flecked with white where it bites.
    float fine = smoothstep(1.2, 0.25, footprint);
    float fleck = smoothstep(0.72, 0.92, vnoise(chopAt * 1.4 + 5.1)) * fine;
    col = mix(col, col * 0.7 + skyLight * 0.55, squall * 0.6);
    col += hazeBase * fleck * squall * 0.12;

    // Sun glitter: each ripple facet that tilts the sun into the eye. The
    // roughness grows with the pixel footprint so far facets blend into a path.
    vec3 H = normalize(sunDir + V);
    float nh = max(dot(N, H), 0.0);
    float shininess = mix(2400.0, 180.0, clamp(footprint * 2.0, 0.0, 1.0));
    float spec = pow(nh, shininess) * (shininess * 0.05);
    col += sunColor * spec * fresnel * 6.0;

    // Air between here and the eye: warmer and brighter towards the sun.
    vec3 viewDir = -V;
    float toSun = pow(max(dot(viewDir, sunDir), 0.0), 6.0);
    vec3 haze = mix(hazeBase, hazeSun, toSun);
    float h = 1.0 - exp(-dist * hazeDensity);
    col = mix(col, haze, h);

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createWater(options: WaterOptions): Water {
  const { dirs, params } = spectrum(options.wind);
  const waveDir: Vector2[] = [];
  const waveParam: Vector4[] = [];
  for (let i = 0; i < WAVES; i++) {
    waveDir.push(new Vector2(dirs[i * 2], dirs[i * 2 + 1]));
    waveParam.push(
      new Vector4(params[i * 4], params[i * 4 + 1], params[i * 4 + 2], params[i * 4 + 3]),
    );
  }

  const shader = {
    name: "IntroWater",
    uniforms: {
      color: { value: new Color() },
      tDiffuse: { value: null },
      textureMatrix: { value: null },
      time: { value: 0 },
      sunDir: { value: new Vector3(0, 0.05, -1) },
      sunColor: { value: new Color(1, 0.6, 0.35) },
      windDir: { value: options.wind.clone().normalize() },
      waveDir: { value: waveDir },
      waveParam: { value: waveParam },
      // Atlantic water at dusk: almost black, a little green in what it scatters.
      deepColor: { value: new Color(0.0025, 0.009, 0.016) },
      scatterColor: { value: new Color(0.02, 0.07, 0.075) },
      skyLight: { value: new Color(0.1, 0.12, 0.15) },
      hazeBase: { value: new Color(0.5, 0.45, 0.45) },
      hazeSun: { value: new Color(1.2, 0.7, 0.4) },
      hazeDensity: { value: 0.00012 },
      squallCentre: { value: new Vector2() },
      squallSize: { value: new Vector2(1, 1) },
      squallPower: { value: 0 },
    },
    vertexShader,
    fragmentShader,
  };

  const size = 40000;
  const mesh = new Reflector(new PlaneGeometry(size, size), {
    shader,
    textureWidth: Math.round(options.width * options.reflectionScale),
    textureHeight: Math.round(options.height * options.reflectionScale),
    clipBias: 0.0005,
    multisample: 0,
  });
  mesh.rotation.x = -Math.PI / 2;

  const uniforms = (mesh.material as unknown as { uniforms: typeof shader.uniforms })
    .uniforms;
  const hideFromReflection: Object3D[] = [];

  // Wakes and spray sit on the surface; reflected, they would double up.
  const mirror = mesh.onBeforeRender;
  mesh.onBeforeRender = function (
    this: Reflector,
    renderer: WebGLRenderer,
    scene: Scene,
    camera: Camera,
    ...rest: unknown[]
  ) {
    const shown = hideFromReflection.map((o) => o.visible);
    hideFromReflection.forEach((o) => (o.visible = false));
    (mirror as (...args: unknown[]) => void).call(this, renderer, scene, camera, ...rest);
    hideFromReflection.forEach((o, i) => (o.visible = shown[i]));
  } as typeof mesh.onBeforeRender;

  return {
    mesh,
    hideFromReflection,
    update(time, camera, sun, sunColor) {
      uniforms.time.value = time;
      uniforms.sunDir.value.copy(sun);
      uniforms.sunColor.value.copy(sunColor);
      // The sheet follows the camera so its edge is never in view; the ripples
      // are in world coordinates, so the water itself does not move with it.
      mesh.position.set(camera.position.x, 0, camera.position.z);
    },
    setHaze(base, toSun, density) {
      uniforms.hazeBase.value.copy(base);
      uniforms.hazeSun.value.copy(toSun);
      uniforms.hazeDensity.value = density;
    },
    setSkyLight(sky) {
      uniforms.skyLight.value.copy(sky);
    },
    setSquall(squall, t) {
      uniforms.squallPower.value = squallAt(squall, t, uniforms.squallCentre.value);
      uniforms.squallSize.value.set(squall.along, squall.across);
    },
    resize(width, height) {
      mesh
        .getRenderTarget()
        .setSize(
          Math.round(width * options.reflectionScale),
          Math.round(height * options.reflectionScale),
        );
    },
    dispose() {
      mesh.dispose();
      mesh.geometry.dispose();
    },
  };
}
