// A bench for the people's bodies and moves (dev only): open
// /scripts/poselab/index.html?scene=walk&view=side on the dev server.
// Figures stand in a row, each dressed and doing one thing, lit like the 3D view.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Human, loadHumans, type Look } from '../../src/client/render3d/humans';
import { Motion, idleAct, styleFor, type Act } from '../../src/client/render3d/motion';

const q = new URLSearchParams(location.search);
const scene = q.get('scene') ?? 'walk';
const view = q.get('view') ?? 'front';
const W = innerWidth;
const H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);
const s3 = new THREE.Scene();
s3.background = new THREE.Color('#DCE7EF');
const pm = new THREE.PMREMGenerator(renderer);
s3.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
s3.environmentIntensity = 0.28;
const sun = new THREE.DirectionalLight('#FFF4E2', 2.4);
sun.position.set(4, 8, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -8;
sun.shadow.camera.right = 8;
sun.shadow.camera.top = 8;
sun.shadow.camera.bottom = -8;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
s3.add(sun, new THREE.HemisphereLight('#CFE2F6', '#B8A383', 0.7));
const fill = new THREE.DirectionalLight('#FFFFFF', 0.3);
fill.position.set(-3, 3, 8);
s3.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#CFC6B4', roughness: 0.95 }));
ground.receiveShadow = true;
s3.add(ground);
const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 200);

const SKINS = ['#6E452C', '#E9BD99', '#553421', '#8C5B3C', '#C08A5E', '#402619'];
const AFRICAN = { african: 1, asian: 0, caucasian: 0 };
const EUROPEAN = { african: 0, asian: 0, caucasian: 1 };
function look(i: number, o: Partial<Look> = {}): Look {
  const skin = o.skin ?? SKINS[i % SKINS.length];
  const light = ['#E9BD99', '#C08A5E'].includes(skin);
  const sex = o.sex ?? 'M';
  return {
    sex, age: 35, height: sex === 'F' ? 1.62 : 1.72, weight: 0.5, muscle: 0.5, ancestry: light ? EUROPEAN : AFRICAN, details: {},
    skin, eyes: light ? '#4A6FA0' : '#3A2414', hair: null, hairColor: light ? '#5A3E28' : '#16110E', crop: 1, recede: 0,
    brows: sex === 'F' ? 'eyebrow010' : 'eyebrow001', browColor: light ? '#4A3526' : '#16110E', lashes: sex === 'F' ? 'eyelashes02' : 'eyelashes01',
    beard: sex === 'M' && (o.age ?? 35) >= 18 ? 0.35 : 0, wear: outfit(i, sex), onesie: null, ...o,
  };
}
const TOPS = ['#3E7CB1', '#C0392B', '#2E8B57', '#8E44AD', '#E0A030', '#F4F3EF'];
const BOTTOMS = ['#2B3A55', '#34466A', '#8A7A5E', '#26282D'];
function outfit(i: number, sex: 'M' | 'F'): Look['wear'] {
  const top = TOPS[i % TOPS.length];
  const bottom = BOTTOMS[i % BOTTOMS.length];
  if (sex === 'F') {
    const tops = ['f_tee', 'f_blouse'];
    const bottoms = ['f_jeans', 'f_skirt', 'f_shorts'];
    return [{ id: bottoms[i % 3], colors: [bottom] }, { id: tops[i % 2], colors: [top] }, { id: ['shoes05', 'shoes01', 'shoes06'][i % 3], colors: [] }];
  }
  const tops = ['m_tee', 'm_shirt', 'm_longtee', 'm_jacket'];
  return [{ id: i % 5 === 4 ? 'm_trousers' : 'm_jeans', colors: [bottom] }, { id: tops[i % 4], colors: [top] }, { id: ['shoes04', 'shoes02', 'shoes03'][i % 3], colors: [] }];
}
function mix(a: string, b: string, t: number): string {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}
void mix;

interface Fig { h: Human; m: Motion; act: Act; x: number; z: number; yaw: number; walkDir?: number; seat?: THREE.Mesh }
const figs: Fig[] = [];
const info = document.getElementById('info')!;

loadHumans().then((kit) => {
  const add = (lk: Look, act: Partial<Act>, x: number, z = 0, yaw = 0) => {
    const h = new Human(kit);
    h.setLook(lk);
    const m = new Motion(h, styleFor({ seed: figs.length * 17 + 3, female: lk.sex === 'F', age: lk.age, archetype: 'balanced', mood: 0.3, energy: 1 }), figs.length * 31 + 7);
    const a = { ...idleAct(), ...act };
    h.root.position.set(x, 0, z);
    h.root.rotation.y = yaw;
    s3.add(h.root);
    const f: Fig = { h, m, act: a, x, z, yaw };
    if (a.base === 'sit' || a.base === 'drive') {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, a.seat, 0.44), new THREE.MeshStandardMaterial({ color: '#8A6A4A', roughness: 0.8 }));
      seat.position.set(0, a.seat / 2, 0.02);
      seat.castShadow = seat.receiveShadow = true;
      h.root.add(seat);
      seat.scale.setScalar(1 / h.scale);
      seat.position.multiplyScalar(1 / h.scale);
    }
    figs.push(f);
    return f;
  };
  const sp = 1.1;
  if (scene === 'walk') {
    add(look(0, { hair: 'short02', crop: 0 }), { base: 'walk', speed: 1.35, simSpeed: 1.35 }, -2 * sp);
    add(look(1, { sex: 'F', hair: 'bob02', crop: 0, skin: '#E9BD99', height: 1.64 }), { base: 'walk', speed: 1.25, simSpeed: 1.25 }, -sp);
    add(look(2, { weight: 0.8, age: 58, recede: 0.6, hairColor: '#8A8580' }), { base: 'walk', speed: 1.1, simSpeed: 1.1 }, 0);
    add(look(3, { sex: 'F', age: 8, height: 1.28, hair: 'ponytail01', crop: 0 }), { base: 'walk', speed: 1.2, simSpeed: 1.2 }, sp);
    add(look(4, { age: 11, height: 1.42 }), { base: 'walk', speed: 3.4, simSpeed: 3.4 }, 2 * sp);
    add(look(5, { sex: 'F', weight: 0.75, hair: null, crop: 0.9, age: 70, height: 1.58, hairColor: '#C9C5BF' }), { base: 'walk', speed: 0.9, simSpeed: 0.9, elderly: true }, 3 * sp);
  } else if (scene === 'stand') {
    const styles = ['relaxed', 'crossed', 'pockets', 'behind', 'akimbo', 'clasped', 'phone'] as const;
    styles.forEach((st, i) => {
      const f = add(look(i, { sex: i % 2 ? 'F' : 'M', hair: i % 2 ? (['bob01', 'long01', 'ponytail01'] as const)[i % 3] : null, crop: i % 2 ? 0 : 1 }), { base: 'stand' }, (i - 3) * sp);
      (f.m as any).arms = st;
      (f.m as any).armsUntil = 1e9;
    });
  } else if (scene === 'sit') {
    add(look(0), { base: 'sit', seat: 0.46 }, -2 * sp);
    add(look(1, { sex: 'F', hair: 'long01', crop: 0 }), { base: 'sit', seat: 0.46, activity: 'type' }, -sp);
    add(look(2, { weight: 0.75 }), { base: 'drive', seat: 0.42, wheel: 0.3 }, 0);
    add(look(3, { age: 6, height: 1.15, sex: 'F' }), { base: 'sit', seat: 0.46 }, sp);
    add(look(4, { sex: 'F', age: 60 }), { base: 'sit', seat: 0.45, tone: 'prayer' }, 2 * sp);
    add(look(5), { base: 'lie', roll: 0, sleeping: true }, 3.4 * sp, 0, 0);
  } else if (scene === 'talk') {
    const a = add(look(0), { base: 'stand', speaking: true, tone: 'warm' }, -0.55, 0, Math.PI / 2);
    const b = add(look(1, { sex: 'F', hair: 'bob01', crop: 0 }), { base: 'stand', listening: true, tone: 'warm' }, 0.55, 0, -Math.PI / 2);
    a.act.lookAt = new THREE.Vector3(0.55, 1.5, 0);
    b.act.lookAt = new THREE.Vector3(-0.55, 1.62, 0);
    const c = add(look(2, { weight: 0.7, age: 60, recede: 0.5 }), { base: 'stand', listening: true, tone: 'joy' }, 0, 0.8, Math.PI);
    c.act.lookAt = new THREE.Vector3(-0.55, 1.62, 0);
  } else if (scene === 'probe') {
    // One bone turned at a time, no animation: which way each axis goes.
    const probes: Array<[string, 'x' | 'y' | 'z', number]> = q.get('rest') ? [['head', 'y', 0], ['head', 'y', 0], ['head', 'y', 0]] : [['upperarmL', 'x', -1], ['upperarmL', 'z', -0.6], ['upperarmL', 'y', 1], ['forearmL', 'x', -1.5], ['forearmL', 'y', 1], ['thighL', 'x', -1], ['shinL', 'x', 1], ['head', 'y', 0.8]];
    probes.forEach(([bone, ax, v], i) => {
      const f = add(look(i), { base: 'stand' }, (i - 3.5) * 0.9);
      (f as any).probe = [bone, ax, v];
    });
  } else if (scene === 'ages') {
    // Girls and women, boys and men, from a toddler to old age.
    const ages = [2, 5, 8, 11, 13, 15, 17, 25, 45, 70];
    const H = { F: [0.87, 1.1, 1.28, 1.45, 1.55, 1.59, 1.61, 1.62, 1.62, 1.6], M: [0.87, 1.1, 1.28, 1.44, 1.56, 1.65, 1.69, 1.71, 1.71, 1.69] };
    (['F', 'M'] as const).forEach((sex, r) =>
      ages.forEach((age, i) => {
        const grey = age >= 60 ? '#C9C5BF' : '#16110E';
        add(look(r * 3 + i, { sex, age, height: H[sex][i], skin: SKINS[(i + r) % 2 ? 0 : 3], hair: sex === 'F' && age >= 5 ? (['ponytail01', 'bob02', 'long01'] as const)[i % 3] : null, crop: sex === 'F' && age >= 5 ? 0 : age < 2 ? 0.5 : 1, hairColor: grey, beard: sex === 'M' && age >= 18 ? 0.35 : 0 }), { base: 'stand' }, (i - 4.5) * 0.55, r * -1.1);
      }),
    );
  } else if (scene === 'faces') {
    const who: Array<Partial<Look>> = [
      { sex: 'F', age: 6, height: 1.15 }, { sex: 'M', age: 6, height: 1.16 }, { sex: 'F', age: 14, height: 1.57, hair: 'ponytail01', crop: 0 }, { sex: 'M', age: 14, height: 1.6 },
      { sex: 'F', age: 28, hair: 'bob01', crop: 0 }, { sex: 'M', age: 28 }, { sex: 'F', age: 72, hairColor: '#C9C5BF', crop: 0.9 }, { sex: 'M', age: 72, hairColor: '#C9C5BF', recede: 0.7 },
      { sex: 'F', age: 30, skin: '#E9BD99', hair: 'long01', crop: 0 }, { sex: 'M', age: 30, skin: '#E9BD99', hair: 'short02', crop: 0 },
    ];
    who.forEach((o, i) => add(look(i, o), { base: 'stand' }, (i % 5 - 2) * 0.5, Math.floor(i / 5) * -0.8));
  } else if (scene === 'wardrobe') {
    const W = (id: string, ...colors: string[]) => ({ id, colors });
    const outfits: Array<[Partial<Look>, Look['wear']]> = [
      [{ sex: 'F', age: 1, height: 0.75, crop: 0.4 }, [W('onesie', '#D8E6F2')]],
      [{ sex: 'M', age: 9, height: 1.33 }, [W('m_shorts', '#5D636B'), W('m_shirt', '#F4F3EF'), W('shoes04')]],
      [{ sex: 'F', age: 10, height: 1.38, hair: 'ponytail01', crop: 0 }, [W('skirt_knee', '#1F3B6E'), W('f_blouse', '#F4F3EF'), W('shoes04')]],
      [{ sex: 'F', age: 45, weight: 0.7 }, [W('skirt_long', '#6A2E3E'), W('f_blouse', '#6A2E3E'), W('hat_wrap', '#D9A62E', '#D9A62E'), W('shoes01')]],
      [{ sex: 'M', age: 50 }, [W('m_trousers', '#1D1D22'), W('m_suit', '#1D1D22', '#F4F3EF', '#6A2E3E'), W('shoes04')]],
      [{ sex: 'M', age: 38 }, [W('m_trousers', '#5B6068'), W('m_shirt', '#9DB9D6'), W('coat', '#FBFBF8'), W('shoes04')]],
      [{ sex: 'M', age: 30, muscle: 0.8 }, [W('m_worktee', '#F4F3EF'), W('m_overalls', '#3A4A62'), W('hat_hard', '#F7C948', '#F7C948'), W('shoes03')]],
      [{ sex: 'M', age: 34 }, [W('m_trousers', '#1F2A44'), W('m_shirt', '#2E4C8F'), W('hat_cap', '#1F2A44', '#101522'), W('shoes03')]],
      [{ sex: 'M', age: 60, recede: 0.6, hairColor: '#8A8580' }, [W('m_jeans', '#5E7A46'), W('m_overalls', '#5E7A46'), W('hat_straw', '#D8B96A', '#6A4A2A'), W('shoes03')]],
      [{ sex: 'F', age: 16, height: 1.6, crop: 0.9 }, [W('f_jeans', '#2E3A55'), W('m_jacket', '#8E3B3B'), W('hat_beanie', '#8E3B3B', '#6E2C28'), W('shoes05')]],
      [{ sex: 'F', age: 30, hair: 'long01', crop: 0 }, [W('onesie', '#E6D8DD')]],
      [{ sex: 'F', age: 40, hair: 'braid01', crop: 0, skin: '#A9744F', ancestry: { african: 0.25, asian: 0.05, caucasian: 0.7 }, hairColor: '#120E0C' }, [W('skirt_long', '#B0203A'), W('f_tee', '#D9A62E'), W('sari_pallu', '#B0203A', '#D9A62E'), W('shoes01')]],
    ];
    outfits.forEach(([o, wear], i) => add(look(i, { ...o, wear }), { base: 'stand' }, (i - 5) * 0.62));
  } else if (scene === 'heritage') {
    // South Africa's peoples: a woman and a man of each (MakeHuman ancestry mixes; ?mix=af,as,ca overrides the Indian one).
    const mixArg = (q.get('mix') ?? '').split(',').map(Number);
    const indian = mixArg.length === 3 ? { african: mixArg[0], asian: mixArg[1], caucasian: mixArg[2] } : { african: 0.2, asian: 0.05, caucasian: 0.75 };
    const people: Array<[string, Partial<Look>]> = [
      ['nguni', { ancestry: { african: 1, asian: 0, caucasian: 0 }, skin: '#6E452C', hairColor: '#16110E', eyes: '#3A2414' }],
      ['afrikaner', { ancestry: { african: 0, asian: 0, caucasian: 1 }, skin: '#EAC7AE', hairColor: '#7A5634', eyes: '#4A6FA0' }],
      ['english', { ancestry: { african: 0, asian: 0, caucasian: 1 }, skin: '#E6BFA3', hairColor: '#A67C4E', eyes: '#5E8A6A' }],
      ['indian', { ancestry: indian, skin: '#A9744F', hairColor: '#120E0C', eyes: '#2C1A0E' }],
      ['coloured', { ancestry: { african: 0.45, asian: 0.2, caucasian: 0.35 }, skin: '#B98660', hairColor: '#1D1612', eyes: '#4A2E18' }],
    ];
    people.forEach(([, o], i) => {
      const light = i === 1 || i === 2;
      add(look(i, { ...o, sex: 'F', hair: i === 0 ? 'bob02' : i === 3 ? 'braid01' : i === 4 ? 'ponytail01' : 'long01', crop: 0, height: 1.62, eyes: o.eyes }), { base: 'stand' }, (i - 2) * 0.55, 0);
      add(look(i + 7, { ...o, sex: 'M', hair: i === 0 ? null : 'short02', crop: i === 0 ? 1 : 0, height: 1.72, beard: light ? 0.2 : 0.4 }), { base: 'stand' }, (i - 2) * 0.55, -0.9);
    });
  } else if (scene === 'looks') {
    (['short01', 'short02', 'short03', 'short04', 'afro01', 'bob01', 'bob02', 'braid01', 'long01', 'ponytail01'] as const).forEach((hs, i) =>
      add(look(i, { hair: hs, crop: 0, sex: i >= 5 ? 'F' : 'M', height: i >= 5 ? 1.64 : 1.76 }), { base: 'stand' }, (i - 4.5) * 0.8),
    );
  }
  for (const f of figs) {
    if (q.get('far')) f.h.setFar(true);
    f.m.update(0, 0.016, f.act);
    f.m.snap();
  }
  (window as any).__figs = figs;
  (window as any).__ready = true;
});

// Camera per view.
const n = () => Math.max(1, figs.length);
function place(): void {
  const span = (scene === 'looks' ? 6.5 : scene === 'talk' ? 2.6 : scene === 'ages' ? 6 : scene === 'faces' ? 2.8 : scene === 'wardrobe' ? 5.5 : scene === 'heritage' ? 2.9 : figs.length * 1.1 + 0.6) / Number(q.get('zoom') ?? 1);
  if (view === 'three') {
    cam.position.set(span * 0.75, 1.35, span * 1.0);
    cam.lookAt(0, 0.85, 0);
  } else if (view === 'side') {
    cam.position.set(span * 1.25, 1.0, 0.3);
    cam.lookAt(0, 0.85, 0);
  } else if (view === 'heads') {
    cam.position.set(0, 1.78, 2.1);
    cam.lookAt(0, 1.52, -0.45);
  } else if (view === 'body') {
    const f = figs[Number(q.get('fig') ?? 0)];
    const x = f ? f.h.root.position.x : 0;
    const z = f ? f.h.root.position.z : 0;
    const y = Number(q.get('y') ?? 1.1);
    cam.position.set(x + Number(q.get('dx') ?? 0.3), y, z + Number(q.get('d') ?? 0.9));
    cam.lookAt(x, y - 0.02, z);
  } else if (view === 'close') {
    const f = figs[Number(q.get('fig') ?? 0)];
    const x = f ? f.h.root.position.x : 0;
    const z = f ? f.h.root.position.z : 0;
    const top = f ? f.h.hipY + f.h.eyeY : 1.5;
    cam.position.set(x + 0.15, top, z + 1.3);
    cam.lookAt(x, top - 0.08, z);
  } else if (view === 'top') {
    cam.position.set(0, span * 2.2, span * 1.1);
    cam.lookAt(0, 0.6, 0);
  } else {
    cam.position.set(0.3, 1.1, span * 1.25);
    cam.lookAt(0.3, 0.85, scene === 'looks' ? -0.8 : 0);
  }
}
let t = 0;
let last = performance.now();
const fixedT = q.get('t') ? Number(q.get('t')) : null;
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  for (const f of figs) {
    const pr = (f as any).probe as [string, 'x' | 'y' | 'z', number] | undefined;
    if (pr) {
      for (const b of f.h.bones) b.quaternion.identity();
      f.h.bone('hips').position.set(0, f.h.hipY, 0);
      f.h.bone(pr[0]).rotation[pr[1]] = pr[2];
      continue;
    }
    f.m.update(fixedT ?? t, dt, f.act);
    // Face probes: ?jaw=0.3 opens every mouth, ?lids=1 closes every eye (after the animator has posed them).
    if (q.get('jaw')) f.h.bone('jaw').rotation.x = Number(q.get('jaw'));
    if (q.get('lids')) for (const n of ['lidL', 'lidR']) f.h.bone(n).rotation.x = Number(q.get('lids')) * 0.62;
    if (f.act.base === 'walk' && q.get('move') === '1') {
      f.h.root.position.z += f.act.speed * dt;
      if (f.h.root.position.z > 3) f.h.root.position.z = -3;
    }
  }
  place();
  renderer.render(s3, cam);
  info.textContent = `${scene} · ${view} · ${figs.length} figures · t ${t.toFixed(1)}`;
  void n;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
