// The 3D view: a WebGL scene of the province around the camera, synced every
// frame to the simulation. Lighting follows the sim's clock — the sun where it
// stands for the province's latitude, the day of the year and the hour (warm at
// dawn and dusk, moonlight at night), a soft sky and ground bounce, a gentle
// fill from the camera's side so faces read, soft shadows and a haze with depth.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { World } from '../../sim/types';
import type { Camera } from '../lib/camera';
import { People3D } from './people3d';
import { Vehicles3D, roofFade } from './vehicles3d';
import { nightDarkness } from '../../sim/time';
import { sunPosition } from './sun';
import { FOV, poseFor } from './view3d';
import { type Cover, Precipitation, RainPass } from './weather3d';
import { World3D, treeWind } from './world3d';

export interface Frame3D {
  world: World;
  cam: Camera;
  w: number;
  h: number;
  dpr: number;
  dt: number;
  micro: boolean;
  selectionId: string | null;
  hoverId: string | null;
  followId: string | null;
  highlightHouseholdId: string | null;
  dayOfYear: number;
  latitude: number;
  singers: Set<string>;
  speakers: Set<string>;
  /** Simulated seconds per real second (0 when paused). */
  timeScale: number;
}

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 5000);
  private world: World;
  private w3: World3D;
  private people: People3D;
  private vehicles: Vehicles3D;
  private sun = new THREE.DirectionalLight('#FFF3DF', 3);
  private fill = new THREE.DirectionalLight('#FFFFFF', 0.45);
  private hemi = new THREE.HemisphereLight('#CFE2F6', '#B8A383', 1.1);
  private fog = new THREE.Fog('#DDE6EC', 200, 900);
  private t = 0;
  private w = 1;
  private h = 1;
  private dpr = 1;
  private shadowSize = 0;
  /** The frame is drawn through: the scene, ambient occlusion (up close), bloom (at night), output. */
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private ao: GTAOPass;
  /** The sky: a dome at the far plane, horizon to zenith, with the sun's glow. */
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  /** Warm light pooling in the lit, lived-in buildings nearest the camera at night. */
  private roomLights: THREE.PointLight[] = [];
  /** Rain and snow, falling outdoors only (drawn by their own pass, against the scene's depth). */
  private precip = new Precipitation();
  /** The buffer the scene was drawn into this frame: its depth is what the rain is tested against. */
  private sceneTarget: THREE.WebGLRenderTarget | null = null;
  /** Distance from the eye to the look-at point, and the visible ground radius, this frame. */
  dist = 100;
  radius = 100;
  night = 0;
  /** The map point the camera looked at when this frame was drawn. */
  lookX = 0;
  lookY = 0;

  constructor(readonly canvas: HTMLCanvasElement, world: World) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Neutral tone mapping keeps the palette's colours (ACES bleaches the light ones).
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color('#DDE6EC');
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target, this.fill, this.fill.target, this.hemi);
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight('#FFC98A', 0, 20, 1.6);
      this.roomLights.push(l);
      this.scene.add(l);
    }
    // (with a depth texture, for the rain)
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(1, 1) }));
    const scenePass = new RenderPass(this.scene, this.camera);
    const drawScene = scenePass.render.bind(scenePass);
    scenePass.render = (...args: Parameters<RenderPass['render']>) => {
      this.sceneTarget = args[2];
      drawScene(...args);
    };
    this.composer.addPass(scenePass);
    // Contact shading where things meet: feet on the floor, furniture against walls, the corners of rooms.
    this.ao = new GTAOPass(this.scene, this.camera, 1, 1);
    this.ao.blendIntensity = 0.9;
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.2, thickness: 1, scale: 1, samples: 12 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.composer.addPass(this.ao);
    // Rain and snow over the scene, never over the inside of a room.
    this.composer.addPass(new RainPass(this.precip, this.camera, () => this.sceneTarget));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.45, 0.9);
    // A single pixel the scene shades as NaN (a sliver of a vehicle, now and then) is smeared by the bloom's
    // blur into a dark block over half the screen for that frame: the night-time flicker. Zero any texel that
    // is not a finite colour before the bright pass sees it (comparisons with NaN are false, so this catches
    // infinities too).
    const highPass = this.bloom.materialHighPassFilter;
    highPass.fragmentShader = highPass.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      'vec4 texel = texture2D( tDiffuse, vUv );\n\t\t\tif ( !( all( greaterThanEqual( texel.rgb, vec3( 0.0 ) ) ) && all( lessThan( texel.rgb, vec3( 65000.0 ) ) ) ) ) texel = vec4( 0.0 );',
    );
    highPass.needsUpdate = true;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: { horizon: { value: new THREE.Color() }, zenith: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, glow: { value: 1 } },
        vertexShader: `varying vec3 vDir;
          void main() {
            vDir = position;
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = clamp(d.y, 0.0, 1.0);
            vec3 c = mix(horizon, zenith, pow(h, 0.5));
            float s = max(dot(d, sunDir), 0.0);
            c += sunCol * (pow(s, 900.0) * 6.0 + pow(s, 48.0) * 0.45 + pow(s, 6.0) * 0.12) * glow;
            gl_FragColor = vec4(c, 1.0);
          }`,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.world = world;
    this.w3 = new World3D(world);
    this.people = new People3D(world, this.w3);
    this.vehicles = new Vehicles3D(world);
    this.scene.add(this.w3.root, this.people.root, this.vehicles.root);
  }

  /** A new simulation (reset or loaded): rebuild everything for its world. */
  private setWorld(world: World): void {
    this.scene.remove(this.w3.root, this.people.root, this.vehicles.root);
    this.people.clear();
    this.vehicles.clear();
    this.world = world;
    this.w3 = new World3D(world);
    this.people = new People3D(world, this.w3);
    this.vehicles = new Vehicles3D(world);
    this.scene.add(this.w3.root, this.people.root, this.vehicles.root);
  }

  resize(w: number, h: number, dpr: number): void {
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.ao.setSize(Math.round(w * dpr), Math.round(h * dpr));
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  update(f: Frame3D): void {
    if (f.world !== this.world) this.setWorld(f.world);
    this.resize(f.w, f.h, f.dpr);
    this.t += f.dt;
    treeWind.time.value = this.t;
    treeWind.strength.value = Math.min(1.6, 0.15 + f.world.weather.windKmh / 25);
    // Camera
    const pose = poseFor(f.cam, f.h);
    this.camera.position.set(...pose.eye);
    this.camera.up.set(...pose.up);
    this.camera.lookAt(...pose.target);
    this.dist = pose.dist;
    this.camera.fov = pose.fov;
    this.camera.near = Math.max(0.1, pose.dist * 0.05);
    this.camera.far = pose.dist * 8 + 600;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.lookX = f.cam.x;
    this.lookY = f.cam.y;
    this.radius = this.visibleRadius(f.cam.x, f.cam.y);
    // Time of day
    const world = f.world;
    const sp = sunPosition(f.latitude, f.dayOfYear, world.minuteOfDay);
    const dir = new THREE.Vector3(sp.x, sp.y, sp.z);
    const elevation = sp.elevation;
    // Darkness on the interface's own clock (40-minute dusk and dawn ramps), so the chrome turns dark as the scene does.
    this.night = nightDarkness(f.latitude, f.dayOfYear, world.minuteOfDay);
    const day = 1 - this.night;
    const golden = Math.max(0, Math.min(1, 1 - (elevation - 2) / 18)) * day;
    const cond = world.weather.condition;
    const overcast = cond === 'rain' || cond === 'storm' || cond === 'cloudy' || cond === 'fog' || cond === 'snow' ? 1 : 0;
    // A storm's lightning: the sky and the light it gives flare for a moment (the scene's own light, not a flash over the screen).
    const flash = cond === 'storm' ? lightning(this.t) : 0;
    const sunCol = new THREE.Color('#FFF4E2').lerp(new THREE.Color('#FFB067'), golden * 0.85);
    const moonDir = dir.clone().multiplyScalar(-1);
    moonDir.y = Math.abs(moonDir.y) * 0.6 + 0.35;
    moonDir.normalize();
    const lightDir = day > 0.02 ? dir : moonDir;
    if (lightDir.y < 0.08) lightDir.y = 0.08;
    lightDir.normalize();
    this.sun.color.copy(day > 0.02 ? sunCol : new THREE.Color('#8EA6DA'));
    this.sun.intensity = day > 0.02 ? (2.6 - golden * 0.8) * day * (1 - overcast * 0.6) : 0.13;
    const tgt = new THREE.Vector3(f.cam.x, 0, f.cam.y);
    this.sun.position.copy(tgt).addScaledVector(lightDir, 400);
    this.sun.target.position.copy(tgt);
    this.fitShadow(tgt, lightDir);
    // Fill from the camera's side, so faces turned toward us are never black.
    const fd = this.camera.position.clone().sub(tgt).normalize();
    this.fill.position.copy(tgt).addScaledVector(fd, 100).add(new THREE.Vector3(30, 60, 0));
    this.fill.target.position.copy(tgt);
    this.fill.intensity = 0.18 + 0.14 * day;
    this.hemi.color.set(day > 0.02 ? new THREE.Color('#CFE2F6').lerp(new THREE.Color('#F2C9A0'), golden * 0.5) : new THREE.Color('#2C3D66'));
    this.hemi.groundColor.set(day > 0.02 ? '#B8A383' : '#1B1A1E');
    this.hemi.intensity = 0.09 + 0.61 * day + overcast * 0.35 * day + flash * 1.6;
    this.scene.environmentIntensity = 0.02 + 0.26 * day;
    const sky = new THREE.Color('#DCE7EF').lerp(new THREE.Color('#F4D1B0'), golden * 0.55).lerp(new THREE.Color('#0B1224'), this.night).lerp(new THREE.Color('#9AA3AD'), overcast * 0.35 * day).lerp(new THREE.Color('#D8DDF0'), flash * 0.7);
    (this.scene.background as THREE.Color).copy(sky);
    this.fog.color.copy(sky);
    // The sky dome: the haze at the horizon, a deeper blue overhead (grey when overcast, near black at night).
    const u = this.sky.material.uniforms;
    u.horizon.value.copy(sky);
    u.zenith.value.set('#5F8FCB').lerp(new THREE.Color('#E7B48A'), golden * 0.25).lerp(new THREE.Color('#8C959F'), overcast * 0.7).lerp(new THREE.Color('#03060F'), this.night).lerp(new THREE.Color('#C9D0EC'), flash * 0.7);
    u.sunDir.value.copy(dir).normalize();
    u.sunCol.value.copy(sunCol);
    u.glow.value = day > 0.02 && sp.elevation > -2 ? (1 - overcast * 0.85) * day : 0;
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar(this.camera.far * 0.5);
    // Ambient occlusion up close, its reach growing with the view.
    const close = pose.dist < 160;
    this.ao.enabled = close;
    if (close) this.ao.updateGtaoMaterial({ radius: Math.min(3, 0.35 + pose.dist * 0.018) });
    // Haze by real distance (hundreds of metres on a clear day, much less in fog or rain), never so close that
    // a street seen from eye level washes out; from high above, the far edge of the view fades with height.
    const haze = cond === 'fog' ? 0.18 : cond === 'rain' || cond === 'storm' || cond === 'snow' ? 0.45 : cond === 'cloudy' ? 0.75 : 1;
    this.fog.near = Math.max(pose.dist * (cond === 'fog' ? 0.6 : 1.7), 140 * haze);
    this.fog.far = Math.max(pose.dist * (cond === 'fog' ? 2.6 : 6.5), 900 * haze);
    this.renderer.toneMappingExposure = 0.95 + this.night * 0.2;
    this.lightRooms(world, f.cam.x, f.cam.y);
    // The world
    this.w3.setSeason(world.weather.season);
    this.w3.setNight(this.night);
    this.w3.update(f.cam.x, f.cam.y, this.radius + 40, 3);
    if (Math.floor(this.t) % 20 === 0) this.w3.prune(f.cam.x, f.cam.y, 1400);
    // Vehicles first: their passengers are seated where the vehicle is drawn this frame.
    this.vehicles.update({ t: this.t, dt: f.dt, micro: f.micro, cx: f.cam.x, cy: f.cam.y, radius: Math.min(this.radius + 30, 400), night: this.night, eye: this.camera.position, pitch: pose.pitch });
    // Rain and snow round the camera, kept out of the rooms and out of the cabins seen into from above.
    const cabinsOpen = roofFade(pose.pitch) < 0.5;
    this.precip.update({
      world,
      camera: this.camera,
      lookX: f.cam.x,
      lookY: f.cam.y,
      dist: pose.dist,
      dt: f.dt,
      t: this.t,
      night: this.night,
      width: this.w * this.dpr,
      height: this.h * this.dpr,
      dpr: this.dpr,
      vehicles: (x, y, r) => this.vehicles.covers(x, y, r).map((c): Cover => (cabinsOpen ? c : { ...c, floor: undefined })),
    });
    this.people.update({
      t: this.t,
      dt: f.dt,
      micro: f.micro,
      cx: f.cam.x,
      cy: f.cam.y,
      radius: Math.min(this.radius + 10, 220),
      eye: this.camera.position,
      selectedId: f.selectionId,
      hoverId: f.hoverId,
      followId: f.followId,
      highlightHouseholdId: f.highlightHouseholdId,
      singers: f.singers,
      speakers: f.speakers,
      // The app's accent (forest green), a shade brighter so the ring reads on any floor.
      accent: '#2E9E68',
      timeScale: f.timeScale,
      rides: this.vehicles,
      night: this.night,
      fovTan: Math.tan(((pose.fov / 2) * Math.PI) / 180),
    });
  }

  /** The ground the camera sees, as a radius around its look-at point. */
  private visibleRadius(cx: number, cy: number): number {
    let r = 0;
    for (const [sx, sy] of [[0, 0], [this.w, 0], [0, this.h], [this.w, this.h], [this.w / 2, 0]]) {
      const g = this.groundAt(sx, sy);
      r = Math.max(r, g ? Math.hypot(g.x - cx, g.y - cy) : this.dist * 3);
    }
    return Math.min(r, this.dist * 3);
  }

  /** Keep the sun's shadow map on what is in view, with texels snapped so shadows do not crawl as the camera moves. */
  private fitShadow(tgt: THREE.Vector3, dir: THREE.Vector3): void {
    const size = Math.max(18, Math.min(260, this.radius * 1.05));
    const cam = this.sun.shadow.camera;
    if (Math.abs(size - this.shadowSize) > this.shadowSize * 0.08) {
      this.shadowSize = size;
      cam.left = -size;
      cam.right = size;
      cam.top = size;
      cam.bottom = -size;
      cam.near = 1;
      cam.far = 900;
      cam.updateProjectionMatrix();
    }
    const texel = (this.shadowSize * 2) / this.sun.shadow.mapSize.x;
    const snap = (v: number) => Math.round(v / texel) * texel;
    const base = new THREE.Vector3(snap(tgt.x), 0, snap(tgt.z));
    this.sun.position.copy(base).addScaledVector(dir, 400);
    this.sun.target.position.copy(base);
    this.sun.target.updateMatrixWorld();
  }

  /** At night, a warm ceiling light in each of the nearest rooms with someone in them. */
  private lightRooms(world: World, cx: number, cy: number): void {
    const want = this.night > 0.15;
    const lit: Array<{ x: number; y: number; d: number; span: number }> = [];
    if (want) {
      const rooms = new Set<string>();
      for (const id in world.people) {
        const p = world.people[id];
        if (p.alive && !p.away && !p.inVehicleId && p.loc.buildingId && p.loc.roomId) rooms.add(`${p.loc.buildingId}|${p.loc.roomId}`);
      }
      for (const key of rooms) {
        const [bid, rid] = key.split('|');
        const r = world.buildings[bid]?.rooms.find((q) => q.id === rid);
        if (!r || r.kind === 'yard' || r.kind === 'field' || r.kind === 'pitch' || r.kind === 'graves' || r.kind === 'pen' || r.kind === 'stand') continue;
        const x = r.x + r.w / 2;
        const y = r.y + r.h / 2;
        const d = Math.hypot(x - cx, y - cy);
        if (d < this.radius + 20) lit.push({ x, y, d, span: Math.max(r.w, r.h) });
      }
      lit.sort((a, b) => a.d - b.d);
    }
    this.roomLights.forEach((l, i) => {
      const r = lit[i];
      if (!r) {
        l.intensity = 0;
        return;
      }
      l.position.set(r.x, 2.5, r.y);
      // Reach about the room and no further (these lights cast no shadows, so walls do not stop them).
      l.distance = Math.min(24, r.span * 0.62 + 1.5);
      l.intensity = (8 + r.span * 0.4) * this.night;
    });
  }

  render(): void {
    this.bloom.enabled = this.night > 0.25;
    this.bloom.strength = 0.25 + 0.45 * this.night;
    this.composer.render();
  }

  /** Screen position (CSS px) of a point on the map at a height; null when behind the camera. */
  project(x: number, height: number, y: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, height, y).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h };
  }

  /** Where a screen point (CSS px) meets the ground, on the map; null if it looks above the horizon. */
  groundAt(sx: number, sy: number, height = 0): { x: number; y: number } | null {
    const ndc = new THREE.Vector2((sx / this.w) * 2 - 1, -(sy / this.h) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    const hit = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), p);
    return hit ? { x: p.x, y: p.z } : null;
  }

  /** Where each person was drawn (feet, floor, top of the head), for labels and picking. */
  get drawnPeople(): Map<string, { x: number; y: number; floor: number; top: number; lying: boolean }> {
    return this.people.drawn;
  }

  dispose(): void {
    this.people.clear();
    this.vehicles.clear();
    this.precip.dispose();
    this.renderer.dispose();
  }
}

/**
 * A storm's lightning, 0 to 1: every few seconds (not every time) a stroke,
 * flickering twice or three times and fading within half a second.
 */
function lightning(t: number): number {
  const period = 7;
  const k = Math.floor(t / period);
  let f = 0;
  for (const j of [k - 1, k]) {
    if (hash(j) < 0.3) continue;
    const u = t - (j * period + hash(j + 0.37) * (period - 1.5));
    if (u < 0 || u > 1.2) continue;
    const strength = 0.55 + 0.45 * hash(j + 0.71);
    f = Math.max(f, strength * (Math.exp(-((u / 0.045) ** 2)) + 0.7 * Math.exp(-(((u - 0.17) / 0.06) ** 2)) + 0.4 * Math.exp(-(((u - 0.42) / 0.09) ** 2))));
  }
  return Math.min(1, f);
}

function hash(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}
