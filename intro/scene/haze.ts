/**
 * Aerial perspective for every lit material in the intro: distance fades the
 * land towards the colour of the sky behind it, warmer and brighter towards
 * the sun. Three's own fog is one flat colour, which reads as grey paint at
 * sunset; this patch swaps its fog chunk for the same law the water uses, so a
 * cliff and the sea below it dissolve into exactly the same air.
 */
import { Color, Vector3, type Material } from "three";

export const hazeUniforms = {
  hazeBase: { value: new Color(0.5, 0.45, 0.45) },
  hazeSun: { value: new Color(1.2, 0.7, 0.4) },
  hazeDensity: { value: 0.00012 },
  hazeSunDir: { value: new Vector3(0, 0.05, -1) },
};

export function hazed<T extends Material>(material: T): T {
  // Composes with a patch the material already has (the wing's translucency).
  const before = material.onBeforeCompile.bind(material);
  const key = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    Object.assign(shader.uniforms, hazeUniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vHazeWorld;")
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
        vHazeWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vHazeWorld;
        uniform vec3 hazeBase;
        uniform vec3 hazeSun;
        uniform float hazeDensity;
        uniform vec3 hazeSunDir;`,
      )
      .replace(
        "#include <fog_fragment>",
        `{
          vec3 hz = vHazeWorld - cameraPosition;
          float hd = length(hz);
          float toSun = pow(max(dot(hz / hd, hazeSunDir), 0.0), 6.0);
          vec3 air = mix(hazeBase, hazeSun, toSun);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, air, 1.0 - exp(-hd * hazeDensity));
        }`,
      );
  };
  material.customProgramCacheKey = () => key() + "|haze";
  return material;
}
