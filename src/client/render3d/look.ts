// What a person looks like, as data (no three.js, no model file): the body
// (sex, age, height, build, ancestry, face and body details), skin, eyes and
// hair, and what they are wearing. dress.ts fills it in from the
// simulation; humans.ts builds the figure from it.
import type { Sex } from './body/shape';

export type { Sex };

/** Hair as a mesh (MakeHuman's styles, and the kit's own). */
export type HairStyle = 'short01' | 'short02' | 'short03' | 'short04' | 'afro01' | 'bob01' | 'bob02' | 'braid01' | 'long01' | 'ponytail01';
export const HAIR_STYLES: HairStyle[] = ['short01', 'short02', 'short03', 'short04', 'afro01', 'bob01', 'bob02', 'braid01', 'long01', 'ponytail01'];
export type BrowStyle = 'eyebrow001' | 'eyebrow002' | 'eyebrow006' | 'eyebrow007' | 'eyebrow008' | 'eyebrow009' | 'eyebrow010' | 'eyebrow011' | 'eyebrow012';
export type LashStyle = 'eyelashes01' | 'eyelashes02';

/** One garment and its colours (see clothes.ts for the wardrobe). */
export interface Wear {
  id: string;
  /** Colour per slot of the garment (its main colour first). */
  colors: string[];
}

export interface Look {
  sex: Sex;
  /** The build between the female (0) and male (1) shapes (see body/shape.ts); the sex's own end when unset. */
  gender?: number;
  /** Years. */
  age: number;
  /** Standing height, metres (barefoot). */
  height: number;
  /** 0..1, 0.5 average (MakeHuman's weight and muscle). */
  weight: number;
  muscle: number;
  ancestry: { african: number; asian: number; caucasian: number };
  /** Face and body details by name, -1..1 (the kit's detail targets). */
  details: Record<string, number>;
  /** Skin tone (sRGB hex). */
  skin: string;
  /** Iris colour. */
  eyes: string;
  hair: HairStyle | null;
  hairColor: string;
  /** Short hair painted on the scalp: 0 none (bald or covered) .. 1 a full close crop. */
  crop: number;
  /** How far the hairline has receded: 0 none .. 1 far. */
  recede: number;
  brows: BrowStyle;
  browColor: string;
  lashes: LashStyle;
  /** Stubble or a close beard: 0 clean-shaven .. 1 dark. */
  beard: number;
  /** What they are wearing, outermost last. */
  wear: Wear[];
  /** Asleep in night clothes, a baby in a onesie: covered from neck to feet in one colour, or null. */
  onesie: string | null;
}
