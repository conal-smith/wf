/**
 * The film's lens: motion blur, light shafts and the grade.
 *
 * Motion blur is real per-object blur, not a smear of the whole frame. Every
 * object in the film is a pure function of the film's clock, so instead of
 * guessing last frame's positions the scene is posed a shutter-interval
 * earlier, every mesh's world matrix is kept, and then posed again for now.
 * A velocity pass writes how far each pixel moved across that interval, and
 * the blur gathers colour along it. The shutter is the film's, not the
 * display's: the blur looks the same at 60 Hz or 120.
 *
 * The light shafts are screen-space (a radial gather towards the sun of what
 * is bright), so a wing crossing the sun cuts real dark lanes through them.
 */
import {
  Color,
  HalfFloatType,
  Matrix4,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type PerspectiveCamera,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from "three";
import { FullScreenQuad, Pass } from "three/addons/postprocessing/Pass.js";

const velocityMaterial = new ShaderMaterial({
  uniforms: {
    prevViewProjection: { value: new Matrix4() },
    prevModel: { value: new Matrix4() },
  },
  vertexShader: /* glsl */ `
    uniform mat4 prevViewProjection;
    uniform mat4 prevModel;
    varying vec4 vNow;
    varying vec4 vThen;
    void main() {
      vNow = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      vThen = prevViewProjection * prevModel * vec4(position, 1.0);
      gl_Position = vNow;
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec4 vNow;
    varying vec4 vThen;
    void main() {
      vec2 now = vNow.xy / vNow.w;
      vec2 then = vThen.xy / vThen.w;
      // In uv units; alpha 1 marks "geometry here" for the blur.
      gl_FragColor = vec4((now - then) * 0.5, 0.0, 1.0);
    }
  `,
});

const blurShader = {
  uniforms: {
    tColor: { value: null as Texture | null },
    tVelocity: { value: null as Texture | null },
    // For the sky, which has no geometry: where its direction was a shutter ago.
    inverseRotationNow: { value: new Matrix4() },
    rotationThen: { value: new Matrix4() },
    texel: { value: new Vector2() },
    strength: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform sampler2D tVelocity;
    uniform mat4 inverseRotationNow;
    uniform mat4 rotationThen;
    uniform vec2 texel;
    uniform float strength;
    varying vec2 vUv;

    vec2 velocityAt(vec2 uv) {
      vec4 v = texture2D(tVelocity, uv);
      if (v.a > 0.5) return v.xy;
      // Background: the sky only turns with the camera, it does not move.
      vec4 dir = inverseRotationNow * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
      vec4 then = rotationThen * vec4(dir.xyz / dir.w, 0.0);
      return (uv * 2.0 - 1.0 - then.xy / then.w) * 0.5;
    }

    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

    void main() {
      // The fastest motion nearby: a moving edge blurs over what is behind it,
      // as it does through a real shutter, instead of ending in a hard line.
      vec2 v = velocityAt(vUv);
      float best = dot(v, v);
      for (int i = 0; i < 4; i++) {
        vec2 o = vec2(i < 2 ? -1.0 : 1.0, mod(float(i), 2.0) < 1.0 ? -1.0 : 1.0) * texel * 10.0;
        vec2 w = velocityAt(vUv + o);
        float m = dot(w, w);
        if (m > best) { best = m; v = w; }
      }
      v *= strength;
      float len = length(v);
      float maxLen = 0.045;
      if (len > maxLen) v *= maxLen / len;
      if (len * 1.0 / texel.x < 0.75) {
        gl_FragColor = texture2D(tColor, vUv);
        return;
      }
      const int N = 14;
      vec3 sum = vec3(0.0);
      float jitter = hash(gl_FragCoord.xy) - 0.5;
      for (int i = 0; i < N; i++) {
        float t = (float(i) + 0.5 + jitter) / float(N) - 0.5;
        sum += texture2D(tColor, vUv + v * t).rgb;
      }
      gl_FragColor = vec4(sum / float(N), 1.0);
    }
  `,
};

export class MotionBlurPass extends Pass {
  private velocity = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
  private quad: FullScreenQuad;
  private material: ShaderMaterial;
  private prevViewProjection = new Matrix4();
  private prevRotation = new Matrix4();
  private clearColor = new Color();
  strength = 1;

  constructor(
    private scene: Scene,
    private camera: PerspectiveCamera,
    /** Hidden from the velocity pass: sky, water, wakes, spray. */
    private hidden: Object3D[],
    /** Shown only for it: a stand-in for the water surface. */
    private proxies: Object3D[],
  ) {
    super();
    this.material = new ShaderMaterial(blurShader);
    this.quad = new FullScreenQuad(this.material);
    proxies.forEach((p) => (p.visible = false));
  }

  /** Call with the scene posed a shutter-interval before now. */
  capturePrevious() {
    this.scene.updateMatrixWorld();
    this.camera.updateMatrixWorld();
    this.prevViewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.prevRotation.multiplyMatrices(
      this.camera.projectionMatrix,
      new Matrix4().extractRotation(this.camera.matrixWorldInverse),
    );
    this.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      (mesh.userData.prev ??= new Matrix4()).copy(mesh.matrixWorld);
      if (!mesh.userData.velocityHook) {
        mesh.userData.velocityHook = true;
        const before = mesh.onBeforeRender;
        mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
          if (material === velocityMaterial) {
            velocityMaterial.uniforms.prevModel.value.copy(
              mesh.userData.prev && mesh.userData.moves ? mesh.userData.prev : mesh.matrixWorld,
            );
            velocityMaterial.uniformsNeedUpdate = true;
            return;
          }
          before.call(this, renderer, scene, camera, geometry, material, group);
        };
      }
    });
  }

  setSize(width: number, height: number) {
    // Velocity is smooth across a surface: half resolution is plenty.
    this.velocity.setSize(Math.ceil(width / 2), Math.ceil(height / 2));
    this.material.uniforms.texel.value.set(1 / width, 1 / height);
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    const shown = this.hidden.map((o) => o.visible);
    this.hidden.forEach((o) => (o.visible = false));
    this.proxies.forEach((o) => (o.visible = true));
    const background = this.scene.background;
    this.scene.background = null;
    this.scene.overrideMaterial = velocityMaterial;
    velocityMaterial.uniforms.prevViewProjection.value.copy(this.prevViewProjection);

    renderer.setRenderTarget(this.velocity);
    const clearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    renderer.setClearColor(this.clearColor, clearAlpha);

    this.scene.overrideMaterial = null;
    this.scene.background = background;
    this.hidden.forEach((o, i) => (o.visible = shown[i]));
    this.proxies.forEach((o) => (o.visible = false));

    const u = this.material.uniforms;
    u.tColor.value = readBuffer.texture;
    u.tVelocity.value = this.velocity.texture;
    u.strength.value = this.strength;
    u.rotationThen.value.copy(this.prevRotation);
    u.inverseRotationNow.value
      .multiplyMatrices(this.camera.projectionMatrix, new Matrix4().extractRotation(this.camera.matrixWorldInverse))
      .invert();
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.velocity.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}

const shaftShader = {
  uniforms: {
    tColor: { value: null as Texture | null },
    sunUv: { value: new Vector2(0.5, 0.5) },
    aspect: { value: 1 },
    intensity: { value: 0 },
    threshold: { value: 3.5 },
    tint: { value: new Vector3(1, 0.6, 0.3) },
  },
  vertexShader: blurShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tColor;
    uniform vec2 sunUv;
    uniform float aspect;
    uniform float intensity;
    uniform float threshold;
    uniform vec3 tint;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 base = texture2D(tColor, vUv).rgb;
      if (intensity <= 0.0) { gl_FragColor = vec4(base, 1.0); return; }
      vec2 toSun = sunUv - vUv;
      vec2 d = toSun * vec2(aspect, 1.0);
      float fall = exp(-dot(d, d) * 2.2);
      if (fall < 0.02) { gl_FragColor = vec4(base, 1.0); return; }
      const int N = 16;
      vec2 step = toSun / float(N) * 0.9;
      vec2 uv = vUv + step * hash(gl_FragCoord.xy);
      float decay = 1.0;
      vec3 rays = vec3(0.0);
      for (int i = 0; i < N; i++) {
        vec3 c = texture2D(tColor, uv).rgb;
        float l = max(dot(c, vec3(0.2126, 0.7152, 0.0722)) - threshold, 0.0);
        rays += tint * min(l, 8.0) * decay;
        decay *= 0.91;
        uv += step;
      }
      // Fall off with distance from the sun, in a round (not stretched) way.
      gl_FragColor = vec4(base + rays / float(N) * intensity * fall, 1.0);
    }
  `,
};

/** Light shafts from the sun, through whatever stands in front of it. */
export class ShaftPass extends Pass {
  private quad: FullScreenQuad;
  material: ShaderMaterial;

  constructor() {
    super();
    this.material = new ShaderMaterial(shaftShader);
    this.quad = new FullScreenQuad(this.material);
  }

  /** Aim at the sun as the camera sees it; fade out as it leaves the frame. */
  update(sunWorld: Vector3, camera: Camera, aspect: number, strength: number) {
    const p = sunWorld.clone().project(camera);
    const behind = sunWorld.clone().transformDirection(camera.matrixWorldInverse).z > 0;
    const u = this.material.uniforms;
    u.sunUv.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    u.aspect.value = aspect;
    const off = Math.max(Math.abs(p.x), Math.abs(p.y));
    u.intensity.value = behind ? 0 : strength * Math.max(0, 1 - Math.max(0, off - 1) / 0.6);
  }

  render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    this.material.uniforms.tColor.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.quad.dispose();
  }
}

/**
 * The grade, after tone mapping: vignette, a light colour grade, a lens's
 * chromatic fringe at the edges, flare ghosts mirrored through the centre
 * from the sun, a thin anamorphic streak, grain, and the fade from black.
 */
export const gradeShader = {
  uniforms: {
    tDiffuse: { value: null as Texture | null },
    time: { value: 0 },
    fade: { value: 0 },
    resolution: { value: new Vector2(1, 1) },
    sunUv: { value: new Vector2(0.5, 0.5) },
    flare: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float fade;
    uniform vec2 resolution;
    uniform vec2 sunUv;
    uniform float flare;
    varying vec2 vUv;

    void main() {
      vec2 centred = vUv - 0.5;
      // Chromatic fringe, growing towards the corners.
      vec2 ca = centred * dot(centred, centred) * 0.012;
      vec3 c = vec3(
        texture2D(tDiffuse, vUv - ca).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv + ca).b
      );

      if (flare > 0.0) {
        // Ghosts: the sun's light reflected between lens elements, mirrored
        // through the centre, each a little tinted.
        vec2 ghostVec = (vec2(0.5) - sunUv);
        float near = smoothstep(0.08, 0.0, distance(vUv, sunUv + ghostVec * 1.35));
        float near2 = smoothstep(0.035, 0.0, distance(vUv, sunUv + ghostVec * 1.7));
        float near3 = smoothstep(0.06, 0.02, distance(vUv, sunUv + ghostVec * 2.2));
        c += (vec3(1.0, 0.6, 0.3) * near * 0.05 + vec3(0.4, 0.7, 1.0) * near2 * 0.06 + vec3(0.8, 0.5, 1.0) * near3 * 0.035) * flare;
        // The anamorphic streak through the sun.
        float dy = abs(vUv.y - sunUv.y) * resolution.y;
        float streak = exp(-dy * dy * 0.02) * exp(-abs(vUv.x - sunUv.x) * 2.5);
        c += vec3(1.0, 0.62, 0.35) * streak * 0.22 * flare;
      }

      // A light grade: the green the sky model leaves between its orange
      // horizon and blue zenith pulled towards rose, and a touch of contrast.
      c *= vec3(1.025, 0.975, 1.0);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.2);

      vec2 d = centred * vec2(resolution.x / resolution.y, 1.0);
      float vig = smoothstep(1.15, 0.35, length(d));
      c *= mix(0.6, 1.0, vig);
      float g = fract(sin(dot(floor(vUv * resolution) + fract(time * 7.13) * 91.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      c += g * 0.024 * (1.0 - c * 0.5);
      gl_FragColor = vec4(c * fade, 1.0);
    }
  `,
};

/**
 * The scene, antialiased: rendered into its own 4x multisampled target and
 * resolved once into the composer's (single-sampled) buffer. Multisampling
 * the composer's own buffers instead makes every later full-screen pass write
 * four samples and resolve them again, which cost more than the bloom.
 */
export class SceneRenderPass extends Pass {
  private target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
  private quad = new FullScreenQuad(
    new ShaderMaterial({
      uniforms: { tColor: { value: null as Texture | null } },
      vertexShader: blurShader.vertexShader,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        varying vec2 vUv;
        void main() { gl_FragColor = texture2D(tColor, vUv); }
      `,
    }),
  );

  constructor(
    private scene: Scene,
    private camera: Camera,
  ) {
    super();
    this.needsSwap = false;
  }

  setSize(width: number, height: number) {
    this.target.setSize(width, height);
  }

  render(renderer: WebGLRenderer, _writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget) {
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    (this.quad.material as ShaderMaterial).uniforms.tColor.value = this.target.texture;
    renderer.setRenderTarget(readBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.target.dispose();
    this.quad.dispose();
  }
}
