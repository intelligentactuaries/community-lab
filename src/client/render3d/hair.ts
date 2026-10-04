// Hair colour the way Unreal's hair shading defines it (Engine/Shaders/Private/
// HairShadingCommon.ush, GetHairColorFromMelanin): from the pigment in the
// strand rather than a swatch. Melanin (0 none .. 1 full) sets how much
// pigment there is; redness (0 .. 1) how much of it is pheomelanin (red to
// yellow) rather than eumelanin (brown to black). Each pigment absorbs light
// in its own way per channel, and the strand's colour is what survives the
// absorption. One pair of numbers spans white-blond, blond, red, brown and
// black, and a child's pair can lie between their parents'.
//
// References (as cited in the shader): d'Eon et al., "An Energy-Conserving
// Hair Reflectance Model"; Chiang et al., "A Practical and Controllable Hair
// and Fur Model for Production Path Tracing".

/** Absorption per unit of eumelanin and of pheomelanin (r, g, b), Unreal's constants. */
const EUMELANIN = [0.506, 0.841, 1.653] as const;
const PHEOMELANIN = [0.343, 0.733, 1.924] as const;
/** The absorption-to-colour fit, at the strand roughness (β = 0.3) the shader uses. */
const B = 0.3;
const D = 5.969 - 0.215 * B + 2.532 * B ** 2 - 10.73 * B ** 3 + 5.574 * B ** 4 + 0.245 * B ** 5;
/** Unpigmented (grey or white) hair, linear: silvery, not the paper white pure absorption would give. */
const WHITE_HAIR = [0.62, 0.6, 0.58] as const;

/** The strand's absorption (r, g, b) for a melanin and a redness. */
export function hairAbsorption(melanin: number, redness: number): [number, number, number] {
  const m = -Math.log(Math.max(1 - clamp01(melanin), 0.0001));
  const r = clamp01(redness);
  const eu = m * (1 - r);
  const ph = m * r;
  return [eu * EUMELANIN[0] + ph * PHEOMELANIN[0], eu * EUMELANIN[1] + ph * PHEOMELANIN[1], eu * EUMELANIN[2] + ph * PHEOMELANIN[2]];
}

/** The strand's colour, linear (r, g, b), with a share of the strands gone white. */
export function hairLinear(melanin: number, redness: number, whiteness = 0): [number, number, number] {
  const a = hairAbsorption(melanin, redness);
  const w = clamp01(whiteness);
  const c = a.map((x) => Math.exp(-Math.sqrt(x) * D)) as [number, number, number];
  return [c[0] + (WHITE_HAIR[0] - c[0]) * w, c[1] + (WHITE_HAIR[1] - c[1]) * w, c[2] + (WHITE_HAIR[2] - c[2]) * w];
}

/** The strand's colour as an sRGB hex string (what a Look carries). */
export function hairColour(melanin: number, redness: number, whiteness = 0): string {
  const [r, g, b] = hairLinear(melanin, redness, whiteness);
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function hex(linear: number): string {
  const c = Math.max(0, Math.min(1, linear));
  const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(s * 255)
    .toString(16)
    .padStart(2, '0');
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
