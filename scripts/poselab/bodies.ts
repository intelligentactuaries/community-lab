// Static bodies from the kit in the rest pose (dev only): /scripts/poselab/bodies.html?view=front|face
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import kitUrl from '../../src/client/render3d/assets/people/kit.bin?url';
import { loadKit } from '../../src/client/render3d/body/kit';
import { buildBody, gather, seamlessNormals } from '../../src/client/render3d/body/build';
import type { BodyParams } from '../../src/client/render3d/body/shape';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'front';
const W = innerWidth;
const H = innerHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#DCE7EF');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.3;
const sun = new THREE.DirectionalLight('#FFF4E2', 2.4);
sun.position.set(4, 8, 6);
scene.add(sun, new THREE.HemisphereLight('#CFE2F6', '#B8A383', 0.7));
const cam = new THREE.PerspectiveCamera(30, W / H, 0.05, 200);

const specs: Array<[string, number]> = (q.get('who') ?? 'F2,F6,F10,F13,F16,F25,F45,F70,M2,M6,M10,M13,M16,M25,M45,M70').split(',').map((s) => [s[0], Number(s.slice(1))]);
const HEIGHT: Record<string, number[]> = { F: [0.87, 1.16, 1.38, 1.55, 1.61, 1.62, 1.62, 1.6], M: [0.87, 1.16, 1.38, 1.56, 1.69, 1.71, 1.71, 1.69] };
const hAt = (sex: string, age: number) => {
  const ages = [2, 6, 10, 13, 16, 25, 45, 70];
  let i = 0;
  while (i < ages.length - 1 && ages[i + 1] <= age) i++;
  return HEIGHT[sex][i];
};

loadKit(kitUrl).then((kit) => {
  const t0 = performance.now();
  const src = kit.array('body.src') as Uint16Array;
  const uv = kit.array('body.uv') as Float32Array;
  const index = kit.array('body.index') as Uint16Array;
  const mat = new THREE.MeshStandardMaterial({ color: q.get('skin') ?? '#8C5B3C', roughness: 0.6 });
  specs.forEach(([sex, age], i) => {
    const p: BodyParams = { sex: sex as 'M' | 'F', age, weight: 0.5, muscle: 0.5, ancestry: { african: 1, asian: 0, caucasian: 0 }, details: {} };
    const b = buildBody(kit, p, hAt(sex, age));
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(src.length * 3);
    gather(b.pos, src, pos);
    const nor = new Float32Array(src.length * 3);
    seamlessNormals(b.pos, src, index, kit.vertices, nor);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    const m = new THREE.Mesh(g, mat);
    m.position.x = (i - (specs.length - 1) / 2) * (view === 'face' ? 0.32 : 0.62);
    if (view === 'face') m.position.y = 1.5 - b.joints[kit.boneNames.indexOf('eyeL') * 3 + 1];
    scene.add(m);
  });
  console.log('built', specs.length, 'bodies in', (performance.now() - t0).toFixed(1), 'ms');
  (window as any).__ready = true;
});

const zoom = Number(q.get('zoom') ?? 1);
function frame() {
  const span = (specs.length * (view === 'face' ? 0.32 : 0.62)) / zoom;
  if (view === 'face') {
    cam.position.set(0, 1.5, span * 1.25);
    cam.lookAt(0, 1.5, 0);
  } else if (view === 'side') {
    cam.position.set(span * 1.1, 1.0, span * 1.2);
    cam.lookAt(0, 0.8, 0);
  } else {
    cam.position.set(Number(q.get('x') ?? 0), Number(q.get('y') ?? 0.95), span * 1.2);
    cam.lookAt(Number(q.get('x') ?? 0), Number(q.get('ly') ?? 0.8), 0);
    renderer.render(scene, cam);
    requestAnimationFrame(frame);
    return;
    cam.lookAt(0, 0.8, 0);
  }
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
