/**
 * A wing foiler, built from primitives and posed once.
 *
 * Rider space: -z is the direction of travel, +x is the rider's right, +y is
 * up, and the origin is on the water under the board. The wind comes from the
 * left (-x), so this is a rider on a reach with the wing on the leeward side:
 * standing across the board, chest to the wing, arms out to its handles and
 * leaning back to windward against the pull, the way a windsurfer hangs off a
 * boom. The wing's canopy is cambered downwind and its tips curve back towards
 * the rider like a kite's arc.
 *
 * The limbs are placed by two-bone IK from the hips and shoulders to the feet
 * on the deck and the hands on the handles, so the pose holds together for any
 * wing angle. Everything is then baked into one geometry per material, so a
 * rider is a handful of draw calls however many parts it has.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
  type Material,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { hazed } from "./haze";

export interface RiderLook {
  /** Impact vest over the wetsuit. */
  vest: number;
  wing: number;
  board: number;
  mast: number;
  suit: number;
  skin: number;
  hair: number;
  pad: number;
}

/** Height of the board's underside above the water when foiling. */
export const RIDE_HEIGHT = 0.55;
const MAST_Z = 0.16;

/** Where the mast cuts the water, in rider space: wakes and spray start here. */
export const MAST_ENTRY = new Vector3(0, 0, MAST_Z);

/** Shared by every canopy, set each frame: the sun as seen from the camera. */
export const canopyUniforms = {
  sunDirView: { value: new Vector3(0, 0, -1) },
  sunTransmit: { value: new Color(1, 0.6, 0.3) },
};

const materials = new Map<string, Material>();

function cached(key: string, make: () => Material): Material {
  let m = materials.get(key);
  if (!m) {
    m = make();
    materials.set(key, m);
  }
  return m;
}

/**
 * Thin sailcloth lets the light through: with the sun behind it a wing
 * glows its own colour, which is most of what makes one read at sunset.
 */
function canopyMaterial(color: number): Material {
  return cached(`canopy:${color}`, () => {
    const m = new MeshStandardMaterial({
      color,
      vertexColors: true,
      roughness: 0.55,
      side: DoubleSide,
    });
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, canopyUniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec3 sunDirView;\nuniform vec3 sunTransmit;",
        )
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
          // normal faces the eye here, so light arriving from behind the cloth
          // is light the cloth is letting through.
          float through = max(0.0, -dot(normal, sunDirView));
          totalEmissiveRadiance += diffuseColor.rgb * sunTransmit * (0.12 + 1.1 * pow(through, 1.5));`,
        );
    };
    m.customProgramCacheKey = () => "canopy";
    return hazed(m);
  });
}

/**
 * Rim light: against a low sun a figure is a silhouette with a burning edge,
 * and that edge is most of what a rider at sunset looks like. The rim is
 * strongest on the side facing the sun and only when the camera looks
 * towards it, which is when a real backlit edge appears.
 */
function rimmed<T extends MeshPhysicalMaterial>(m: T, strength = 1): T {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, canopyUniforms, { rimStrength: { value: strength } });
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform vec3 sunDirView;\nuniform vec3 sunTransmit;\nuniform float rimStrength;",
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        {
          vec3 V = normalize(vViewPosition);
          float edge = pow(1.0 - abs(dot(normal, V)), 3.5);
          float sunSide = clamp(dot(normalize(normal.xy + 1e-4), normalize(sunDirView.xy + 1e-4)) * 0.5 + 0.5, 0.0, 1.0);
          float facing = smoothstep(-0.2, 0.9, -sunDirView.z);
          totalEmissiveRadiance += sunTransmit * edge * sunSide * sunSide * facing * 0.9 * rimStrength;
        }`,
      );
  };
  m.customProgramCacheKey = () => "rim";
  return m;
}

function solid(kind: string, color: number, params: Partial<MeshPhysicalMaterial>, rim = 1) {
  return cached(`${kind}:${color}`, () =>
    // Little sky fill: a backlit figure reads as a silhouette, not a model.
    hazed(rimmed(new MeshPhysicalMaterial({ color, envMapIntensity: 0.35, ...params }), rim)),
  );
}

// ---- geometry helpers --------------------------------------------------

const Y = new Vector3(0, 1, 0);

/** A capsule from a to b, radius r, scaled across its axis by (sx, sz). */
function limb(a: Vector3, b: Vector3, r: number, sx = 1, sz = 1): BufferGeometry {
  const dir = new Vector3().subVectors(b, a);
  const len = dir.length();
  const g = new CapsuleGeometry(r, Math.max(0.001, len), 6, 18);
  g.scale(sx, 1, sz);
  const q = new Quaternion().setFromUnitVectors(Y, dir.normalize());
  g.applyMatrix4(
    new Matrix4().compose(new Vector3().addVectors(a, b).multiplyScalar(0.5), q, new Vector3(1, 1, 1)),
  );
  return g;
}

function ball(at: Vector3, r: number, sx = 1, sy = 1, sz = 1): BufferGeometry {
  const g = new SphereGeometry(r, 26, 18);
  g.scale(sx, sy, sz);
  g.translate(at.x, at.y, at.z);
  return g;
}

/**
 * Two-bone IK: where the middle joint goes for a chain root -> joint -> end
 * of lengths l1, l2 reaching for target, bending towards pole. The end is
 * clamped to the reach, so an arm too short for a handle stops straight.
 */
export function ik(
  root: Vector3,
  target: Vector3,
  l1: number,
  l2: number,
  pole: Vector3,
): { joint: Vector3; end: Vector3 } {
  const d = new Vector3().subVectors(target, root);
  const dist = Math.min(Math.max(d.length(), 1e-4), l1 + l2 - 1e-4);
  const dir = d.normalize();
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const perp = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
  return {
    joint: root.clone().addScaledVector(dir, a).addScaledVector(perp, h),
    end: root.clone().addScaledVector(dir, dist),
  };
}

/** A tube along points whose radius follows radius(t), t from 0 to 1. */
function tube(points: Vector3[], radius: (t: number) => number, radial = 10): BufferGeometry {
  const curve = new CatmullRomCurve3(points);
  const segments = Math.max(8, points.length * 2);
  const frames = curve.computeFrenetFrames(segments, false);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    curve.getPointAt(t, p);
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      n.copy(frames.normals[i])
        .multiplyScalar(Math.cos(a))
        .addScaledVector(frames.binormals[i], Math.sin(a))
        .normalize();
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
      uv.push(t, j / radial);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(index);
  return g;
}

// ---- the wing ------------------------------------------------------------

// A 5 m² wing: 3.4 m from tip to tip and two metres of chord at the strut,
// which is an aspect ratio of about 2.3, as the real ones are.
const HALF_SPAN = 1.7;
const ARC_MAX = 1.2;
const APEX_Z = -0.8;
const SWEEP = 0.55;
const ARC_DEPTH = 0.32;
const CHORD = 2.05;

/** The leading edge at span position s in [-1, 1] (-1 the lower tip). */
function leadingEdge(s: number): Vector3 {
  const phi = s * ARC_MAX;
  const back = (1 - Math.cos(phi)) / (1 - Math.cos(ARC_MAX));
  return new Vector3(-ARC_DEPTH * back, (HALF_SPAN * Math.sin(phi)) / Math.sin(ARC_MAX), APEX_Z + SWEEP * back);
}

const chordAt = (s: number) => CHORD * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(s), 1.7)), 0.55);

/** The handles, in wing space: front hand, back hand. */
const GRIPS = [new Vector3(-0.125, 0, -0.3), new Vector3(-0.125, 0, 0.17)];

function canopy(): BufferGeometry {
  const ns = 60;
  const nt = 14;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  for (let i = 0; i <= ns; i++) {
    const s = (i / ns) * 2 - 1;
    const le = leadingEdge(s);
    const chord = chordAt(s);
    for (let j = 0; j <= nt; j++) {
      const t = j / nt;
      // Billowed downwind (+x), deepest a third of the way back, and the
      // trailing edge scalloped between the battens.
      const belly = 0.14 * chord * Math.sin(Math.PI * Math.pow(t, 0.8)) * (1 - 0.25 * t);
      const scallop = t > 0.85 ? -0.03 * Math.abs(Math.sin(s * Math.PI * 3.5)) * (t - 0.85) / 0.15 : 0;
      pos.push(le.x + belly, le.y, le.z + chord * t + scallop);
      uv.push(s * 0.5 + 0.5, t);
      // A darker hem along the trailing edge.
      const shade = t > 0.93 ? 0.55 : 1;
      col.push(shade, shade, shade);
    }
  }
  const index: number[] = [];
  for (let i = 0; i < ns; i++)
    for (let j = 0; j < nt; j++) {
      const a = i * (nt + 1) + j;
      const b = a + nt + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function leadingEdgeTube(): BufferGeometry {
  const pts: Vector3[] = [];
  for (let i = 0; i <= 40; i++) pts.push(leadingEdge((i / 40) * 2 - 1));
  return tube(pts, (t) => 0.1 * (1 - 0.62 * Math.pow(Math.abs(t * 2 - 1), 1.6)) + 0.012, 12);
}

function strutTube(): BufferGeometry {
  const pts: Vector3[] = [];
  const z0 = APEX_Z + 0.06;
  const z1 = APEX_Z + CHORD - 0.08;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new Vector3(-0.045 - 0.03 * Math.sin(Math.PI * t), 0, z0 + (z1 - z0) * t));
  }
  return tube(pts, (t) => 0.048 - 0.02 * t, 10);
}

function handle(z: number): BufferGeometry {
  return tube(
    [
      new Vector3(-0.06, 0, z - 0.085),
      new Vector3(-0.11, 0, z - 0.06),
      new Vector3(-0.13, 0, z),
      new Vector3(-0.11, 0, z + 0.06),
      new Vector3(-0.06, 0, z + 0.085),
    ],
    () => 0.016,
    8,
  );
}

// ---- the board and mast --------------------------------------------------

function board(): BufferGeometry {
  const g = new RoundedBoxGeometry(0.56, 0.11, 1.38, 4, 0.045);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i);
    const nose = Math.min(1, Math.max(0, (-z - 0.2) / 0.49));
    const tail = Math.min(1, Math.max(0, (z - 0.5) / 0.19));
    p.setX(i, p.getX(i) * (1 - 0.48 * nose * nose - 0.12 * tail));
    p.setY(i, p.getY(i) + 0.06 * nose * nose * nose);
  }
  g.computeVertexNormals();
  g.translate(0, RIDE_HEIGHT + 0.055, 0);
  return g;
}

function deckPad(): BufferGeometry {
  const g = new RoundedBoxGeometry(0.44, 0.014, 0.66, 2, 0.006);
  g.translate(0, RIDE_HEIGHT + 0.112, 0.27);
  return g;
}

function mast(): BufferGeometry {
  const shape = new Shape();
  const chord = 0.125;
  const thick = 0.017;
  for (let i = 0; i <= 24; i++) {
    const u = (i / 24) * Math.PI * 2;
    // A symmetric section, blunt at the front (-z) and fine at the back.
    const c = Math.cos(u);
    const x = thick * 0.5 * Math.sin(u) * (1 - 0.35 * (c + 1) * 0.5);
    const y = -chord * 0.5 * c;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const g = new ExtrudeGeometry(shape, { depth: 0.95, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(Math.PI / 2); // extrude downwards, chord along z
  g.translate(0, RIDE_HEIGHT, MAST_Z);
  return g;
}

// ---- assembly ------------------------------------------------------------

interface Part {
  geometry: BufferGeometry;
  material: Material;
}

function bake(parts: Part[]): Group {
  const byMaterial = new Map<Material, BufferGeometry[]>();
  for (const { geometry, material } of parts) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    for (const name of Object.keys(g.attributes))
      if (!["position", "normal", "uv", "color"].includes(name)) g.deleteAttribute(name);
    const list = byMaterial.get(material) ?? [];
    list.push(g);
    byMaterial.set(material, list);
  }
  const group = new Group();
  for (const [material, list] of byMaterial) {
    const merged = mergeGeometries(list, false);
    if (!merged) continue;
    group.add(new Mesh(merged, material));
  }
  return group;
}

export interface Pose {
  /** Wing tilt to windward, radians: how far the top of the wing leans over the rider. */
  tilt: number;
  /** Nose-up pitch of the wing, radians. */
  pitch: number;
  /** Sheeting: the leading edge turned into the wind, radians. */
  sheet: number;
  /** How far the rider hangs back to windward, metres at the shoulders. */
  lean: number;
}

export function buildRider(look: RiderLook, pose: Pose): Group {
  const deck = RIDE_HEIGHT + 0.11;
  const suit = solid("suit", look.suit, { roughness: 0.7, sheen: 0.4, sheenRoughness: 0.6, sheenColor: new Color(0.3, 0.3, 0.35) });
  const skin = solid("skin", look.skin, { roughness: 0.55, sheen: 0.2 });
  const hair = solid("hood", look.hair, { roughness: 0.75, sheen: 0.4, sheenColor: new Color(0.3, 0.3, 0.35) });
  const vest = solid("vest", look.vest, { roughness: 0.65, sheen: 0.3 });
  const boardMat = solid("board", look.board, { roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15 }, 0.35);
  const padMat = solid("pad", look.pad, { roughness: 0.95 });
  // A mast is all edge: full rim light would make a black one glow.
  const mastMat = solid("mast", look.mast, { roughness: 0.45, clearcoat: 0.15, envMapIntensity: 0.35 }, 0.12);
  const tubeColor = new Color(look.wing).multiplyScalar(0.62).getHex();
  const tubeMat = solid("tube", tubeColor, { roughness: 0.42, clearcoat: 0.3 });
  const gripMat = solid("grip", 0x1c1c1e, { roughness: 0.7 });
  const parts: Part[] = [];
  const add = (geometry: BufferGeometry, material: Material) => parts.push({ geometry, material });

  add(board(), boardMat);
  add(deckPad(), padMat);
  add(mast(), mastMat);

  // The wing, placed in front of the chest and above the head's height.
  const wingMatrix = new Matrix4().compose(
    new Vector3(0.34, deck + 1.36, -0.06),
    new Quaternion().setFromEuler(new Euler(pose.pitch, pose.sheet, pose.tilt, "YXZ")),
    new Vector3(1, 1, 1),
  );
  for (const g of [canopy()]) add(g.applyMatrix4(wingMatrix), canopyMaterial(look.wing));
  for (const g of [leadingEdgeTube(), strutTube()]) add(g.applyMatrix4(wingMatrix), tubeMat);
  for (const z of [GRIPS[0].z, GRIPS[1].z]) add(handle(z).applyMatrix4(wingMatrix), gripMat);
  const grips = GRIPS.map((g) => g.clone().applyMatrix4(wingMatrix));

  // Body: hips over the board's centre, hanging back to windward.
  const pelvis = new Vector3(-0.12 - pose.lean * 0.3, deck + 0.86, 0.01);
  const spine = new Vector3(-0.15 - pose.lean, 0.5, 0.02).normalize();
  const neck = pelvis.clone().addScaledVector(spine, 0.52);
  const ankles = [new Vector3(0, deck + 0.07, -0.3), new Vector3(0.02, deck + 0.07, 0.3)];
  const hips = [pelvis.clone().add(new Vector3(0, -0.04, -0.1)), pelvis.clone().add(new Vector3(0, -0.04, 0.1))];
  for (let i = 0; i < 2; i++) {
    const leg = ik(hips[i], ankles[i], 0.45, 0.45, new Vector3(1, 0.15, i ? 0.25 : -0.25));
    add(limb(hips[i], leg.joint, 0.072, 1, 1), suit);
    add(limb(leg.joint, leg.end, 0.054), suit);
    // Feet across the deck, toes towards the wing.
    const foot = ball(leg.end.clone().add(new Vector3(0.06, -0.03, 0)), 0.1, 1.3, 0.38, 0.5);
    add(foot, suit);
  }
  add(ball(pelvis, 0.13, 0.95, 0.85, 1.3), suit);
  add(limb(pelvis.clone().addScaledVector(spine, 0.08), neck.clone().addScaledVector(spine, -0.08), 0.128, 0.74, 1.15), suit);
  // An impact vest over the chest and back, a size up from the torso.
  add(limb(pelvis.clone().addScaledVector(spine, 0.2), neck.clone().addScaledVector(spine, -0.1), 0.14, 0.8, 1.2), vest);

  // A neoprene hood with the face showing: the evening Atlantic is cold.
  const head = neck.clone().addScaledVector(spine, 0.19).add(new Vector3(0.02, 0, -0.01));
  add(limb(neck, head, 0.055), suit);
  add(ball(head, 0.1, 0.95, 1.1, 1), skin);
  add(ball(head.clone().add(new Vector3(-0.012, 0.01, 0.022)), 0.108, 1, 1.08, 1), hair);

  const shoulders = [neck.clone().add(new Vector3(0, -0.05, -0.19)), neck.clone().add(new Vector3(0, -0.05, 0.19))];
  for (let i = 0; i < 2; i++) {
    const arm = ik(shoulders[i], grips[i], 0.3, 0.29, new Vector3(-0.2, -1, i ? 0.5 : -0.4));
    add(ball(shoulders[i], 0.068, 1, 1, 1), suit);
    add(limb(shoulders[i], arm.joint, 0.05), suit);
    add(limb(arm.joint, arm.end, 0.042), suit);
    add(ball(arm.end, 0.046), skin);
  }

  return bake(parts);
}
