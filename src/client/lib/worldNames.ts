// How the interface names the world it shows: the built-in province keeps
// its own words; a world from the builder goes by its name.
import { activeAtlas } from '../../sim/atlas';

/** Whether the built-in Unity Province is running. */
export function isProvince(): boolean {
  return activeAtlas().plan === null;
}

/** "the province", or the built world's name. */
export function wholeName(): string {
  return isProvince() ? 'the province' : activeAtlas().name ?? 'the world';
}

/** The scope picker's first entry. */
export function wholeOption(): string {
  return isProvince() ? 'Whole province' : `All of ${activeAtlas().name ?? 'the world'}`;
}
