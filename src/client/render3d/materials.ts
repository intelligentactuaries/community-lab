// The scene's materials: soft, slightly glossy surfaces that catch the light on
// their rounded edges (the "animated film" look), shared by colour so a street
// of houses costs a handful of materials, not thousands.
import * as THREE from 'three';

const cache = new Map<string, THREE.Material>();

/** A matte-to-satin surface: plaster, wood, cloth, skin. */
export function mat(color: string, rough = 0.78, metal = 0, key = ''): THREE.MeshStandardMaterial {
  const k = `s|${color}|${rough}|${metal}|${key}`;
  let m = cache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    cache.set(k, m);
  }
  return m;
}

/** Car paint: a clear coat over the colour. */
export function paint(color: string): THREE.MeshPhysicalMaterial {
  const k = `p|${color}`;
  let m = cache.get(k) as THREE.MeshPhysicalMaterial | undefined;
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12 });
    cache.set(k, m);
  }
  return m;
}

/** Something that gives light: a lamp, a lit window, a head- or tail-light. */
export function glow(color: string, intensity = 1.6, key = ''): THREE.MeshStandardMaterial {
  const k = `g|${color}|${intensity}|${key}`;
  let m = cache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
    cache.set(k, m);
  }
  return m;
}

/** Window glass: dark and reflective by day; the lit variant glows warm at night. */
export const GLASS = new THREE.MeshPhysicalMaterial({ color: '#9DB4C6', roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.55, envMapIntensity: 1.4 });
export const GLASS_LIT = new THREE.MeshStandardMaterial({ color: '#FFE2A8', emissive: '#FFC978', emissiveIntensity: 0, roughness: 0.3 });

/** A soft round shadow under a person or a car (a contact shadow the sun's shadow map is too coarse for). */
let blobTex: THREE.Texture | null = null;
export function blobShadow(): THREE.MeshBasicMaterial {
  const k = 'blob';
  let m = cache.get(k) as THREE.MeshBasicMaterial | undefined;
  if (!m) {
    if (!blobTex) {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      grd.addColorStop(0, 'rgba(0,0,0,0.55)');
      grd.addColorStop(0.55, 'rgba(0,0,0,0.25)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
      blobTex = new THREE.CanvasTexture(c);
    }
    m = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 1 });
    cache.set(k, m);
  }
  return m;
}

/** A tileable grain texture so large flat areas (ground, lawns, asphalt) are not dead flat. */
export function grain(seed: number, base: string, amount: number, size = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const d = (rnd() - 0.5) * 2 * amount * 255;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + d));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + d));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + d));
  }
  g.putImageData(img, 0, 0);
  // A few soft blotches so the grain does not read as noise.
  for (let i = 0; i < 18; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 8 + rnd() * 26;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const a = (rnd() * 0.08).toFixed(3);
    grd.addColorStop(0, rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Deterministic hash of a string to [0, 1). */
export function hash01(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Mix two hex colours (t = 0 gives a, 1 gives b). */
export function mixHex(a: string, b: string, t: number): string {
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  return `#${ca.lerp(cb, t).getHexString()}`;
}

/** Canvas textures for floors, drawn once: wooden planks, square tiles and carpet. */
const floorTex = new Map<string, THREE.CanvasTexture>();
function canvasTex(key: string, size: number, draw: (g: CanvasRenderingContext2D, rnd: () => number) => void): THREE.CanvasTexture {
  let t = floorTex.get(key);
  if (t) return t;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  let s = 97 + key.length * 131;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  draw(g, rnd);
  t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  floorTex.set(key, t);
  return t;
}

export function planks(): THREE.CanvasTexture {
  return canvasTex('planks', 512, (g, rnd) => {
    const n = 8;
    const w = 512 / n;
    for (let i = 0; i < n; i++) {
      let y = -rnd() * 512;
      while (y < 512) {
        const len = 160 + rnd() * 260;
        const v = 225 + Math.floor((rnd() - 0.5) * 40);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(i * w, y, w, len);
        // grain
        g.strokeStyle = 'rgba(0,0,0,0.06)';
        for (let k = 0; k < 6; k++) {
          g.beginPath();
          const gx = i * w + 4 + rnd() * (w - 8);
          g.moveTo(gx, y);
          g.bezierCurveTo(gx + (rnd() - 0.5) * 8, y + len / 3, gx + (rnd() - 0.5) * 8, y + (2 * len) / 3, gx, y + len);
          g.stroke();
        }
        g.fillStyle = 'rgba(0,0,0,0.28)';
        g.fillRect(i * w, y, w, 2);
        y += len;
      }
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(i * w, 0, 2, 512);
    }
  });
}

export function tiles(): THREE.CanvasTexture {
  return canvasTex('tiles', 256, (g, rnd) => {
    const n = 4;
    const w = 256 / n;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const v = 238 + Math.floor((rnd() - 0.5) * 16);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(i * w, j * w, w, w);
    }
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 0; i <= n; i++) {
      g.fillRect(i * w - 1.5, 0, 3, 256);
      g.fillRect(0, i * w - 1.5, 256, 3);
    }
  });
}

export function carpet(): THREE.CanvasTexture {
  return canvasTex('carpet', 128, (g, rnd) => {
    g.fillStyle = '#E8E8E8';
    g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 3500; i++) {
      const v = Math.floor(200 + rnd() * 55);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(rnd() * 128, rnd() * 128, 1.2, 1.2);
    }
  });
}

/** A floor: a colour over a texture repeated every `metres` in world space (see Batch: userData.uvScale). */
export function floor(color: string, tex: 'planks' | 'tiles' | 'carpet' | 'plain', metres: number, rough: number): THREE.MeshStandardMaterial {
  const k = `f|${color}|${tex}|${metres}|${rough}`;
  let m = cache.get(k) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    const map = tex === 'planks' ? planks() : tex === 'tiles' ? tiles() : tex === 'carpet' ? carpet() : null;
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, map });
    m.userData.uvScale = metres;
    cache.set(k, m);
  }
  return m;
}
