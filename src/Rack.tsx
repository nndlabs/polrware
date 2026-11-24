import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type RackItem = {
  id: string;
  name: string;
  material: string;
  price: number;
  w: number;
  h: number;
  back?: boolean; // a real back photo exists at /rack/<id>-back.jpg
};

type Props = {
  items: RackItem[];
  onAdd: (item: RackItem) => void;
  formatPrice: (value: number) => string;
  /** when given, clicking a jacket opens its product window instead of the small panel */
  onPick?: (item: RackItem) => void;
  /** the jacket whose product window is open: it stays turned to the front */
  activeId?: string | null;
};

/* ---------- geometry constants (world units; one jacket is 1.25 wide) ---------- */
const GW = 1.25;
const JTOP = 0.17; // collar top sits low enough that every hanger crown clears the hook curl
const RAIL_TOP = 0.17; // top of the wooden brackets, used to frame the camera
const ROD_R = 0.04;
const REST = 1.2;
const INTRO_TURN = 0.75;
const FRONT_W = 1.4;
const FOV = 20;
const BASE = import.meta.env.BASE_URL;

type DistField = { d: Float32Array; inside: Uint8Array; w: number; h: number };

class Spring {
  v: number;
  t: number;
  vel = 0;
  k: number;
  c: number;
  constructor(v: number, k: number, c: number, reduce: boolean) {
    this.v = v;
    this.t = v;
    if (reduce) {
      k *= 3;
      c = 2 * Math.sqrt(k);
    }
    this.k = k;
    this.c = c;
  }
  step(h: number) {
    const a = this.k * (this.t - this.v) - this.c * this.vel;
    this.vel += a * h;
    this.v += this.vel * h;
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Distance from each pixel to the garment edge: drives how far each panel puffs out. */
function distField(mask: HTMLImageElement, w: number, h: number): DistField {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(mask, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const d = new Float32Array(w * h);
  const inside = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    inside[i] = px[i * 4] > 127 ? 1 : 0;
    d[i] = inside[i] ? 1e5 : 0;
  }
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (inside[i]) d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (inside[i]) d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
    }
  return { d, inside, w, h };
}

function sampleDist(df: DistField, u: number, v: number) {
  const x = clamp(u * df.w - 0.5, 0, df.w - 1.001);
  const y = clamp(v * df.h - 0.5, 0, df.h - 1.001);
  const x0 = x | 0;
  const y0 = y | 0;
  const fx = x - x0;
  const fy = y - y0;
  const { d, w } = df;
  const a = d[y0 * w + x0];
  const b = d[y0 * w + x0 + 1];
  const c = d[(y0 + 1) * w + x0];
  const e = d[(y0 + 1) * w + x0 + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}

/** Two displaced panels (front + back) that bulge in the middle and meet at the outline. */
function buildGeo(width: number, height: number, df: DistField, seed: number) {
  const base = new THREE.PlaneGeometry(width, height, 64, Math.round((64 * height) / width));
  base.translate(0, -JTOP - height / 2, 0);
  const r = rng(seed);
  const ph1 = r() * 6.28;
  const ph2 = r() * 6.28;
  const make = (back: boolean) => {
    const geo = base.clone();
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const T = back ? 0.05 : 0.066;
    for (let k = 0; k < pos.count; k++) {
      const u = uv.getX(k);
      const v = 1 - uv.getY(k);
      const t = Math.min(Math.max(sampleDist(df, u, v) - 1.2, 0) / 16, 1);
      const bulge = 1 - (1 - t) * (1 - t);
      const sx = (u - 0.5) * 2;
      const fold = 0.006 * Math.pow(v, 1.2) * Math.sin(u * Math.PI * 4.2 + ph1) + 0.003 * v * Math.sin(u * Math.PI * 9.4 + ph2);
      const curve = -0.07 * sx * sx * (1 - 0.3 * v);
      pos.setZ(k, (back ? -1 : 1) * (T * bulge + 0.0015) + fold + curve);
    }
    if (back) {
      const idx = geo.index!.array as Uint16Array | Uint32Array;
      for (let k = 0; k < idx.length; k += 3) {
        const tmp = idx[k + 1];
        idx[k + 1] = idx[k + 2];
        idx[k + 2] = tmp;
      }
    }
    geo.computeVertexNormals();
    return geo;
  };
  const out = { front: make(false), back: make(true) };
  base.dispose();
  return out;
}

function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.BoxGeometry(12, 8, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.42, 0.42, 0.43), side: THREE.BackSide })));
  const panel = (w: number, h: number, p: [number, number, number], i: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(i, i, i), side: THREE.DoubleSide }));
    m.position.set(...p);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(5, 3, [0, 3.9, 1], 5);
  panel(3, 5, [-5.5, 0.8, 2], 3.2);
  panel(3, 4, [5.5, 0.4, 1.5], 1.4);
  panel(6, 2.5, [0, 0.5, 5.8], 1.8);
  const tex = pm.fromScene(s, 0.035).texture;
  pm.dispose();
  s.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (o.material as THREE.Material).dispose();
    }
  });
  return tex;
}

/** The wood photo (736 x 1472, grain running top to bottom), shown at real-world scale. */
const WOOD_TEX_H = 1.6; // world units covered by one copy of the photo, top to bottom
function woodTexture(repeatX: number, repeatY: number) {
  const t = new THREE.TextureLoader().load(`${BASE}rack/wood.jpg`);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.MirroredRepeatWrapping; // mirrored so copies meet without a visible seam
  t.wrapT = THREE.MirroredRepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  return t;
}

/** Light-oak rod with rounded ends, carried by two upright rounded-top brackets set in from each end. */
function buildRail(rodHalf: number, bracketX: number) {
  const grp = new THREE.Group();
  const texW = WOOD_TEX_H * (736 / 1472);
  // rod: photo wraps once around part of its width, grain along the length
  const rodMat = new THREE.MeshPhysicalMaterial({
    map: woodTexture((2 * Math.PI * ROD_R) / texW, (2 * rodHalf) / WOOD_TEX_H),
    roughness: 0.55,
    metalness: 0,
    clearcoat: 0.12,
    clearcoatRoughness: 0.5,
  });
  // brackets: extrude UVs are in world units, so scale the photo to the same real-world size
  const plateMat = new THREE.MeshPhysicalMaterial({
    map: woodTexture(1 / texW, 1 / WOOD_TEX_H),
    roughness: 0.6,
    metalness: 0,
    clearcoat: 0.1,
    clearcoatRoughness: 0.5,
  });

  const e = 0.008;
  const profile = [
    new THREE.Vector2(0, -rodHalf),
    new THREE.Vector2(ROD_R - e, -rodHalf),
    new THREE.Vector2(ROD_R - e * 0.3, -rodHalf + e * 0.3),
    new THREE.Vector2(ROD_R, -rodHalf + e),
    new THREE.Vector2(ROD_R, rodHalf - e),
    new THREE.Vector2(ROD_R - e * 0.3, rodHalf - e * 0.3),
    new THREE.Vector2(ROD_R - e, rodHalf),
    new THREE.Vector2(0, rodHalf),
  ];
  // seam (phi = 0) turned to the back; v re-mapped by position so the grain is not squashed
  const rodGeo = new THREE.LatheGeometry(profile, 64, Math.PI, Math.PI * 2);
  const rp = rodGeo.attributes.position as THREE.BufferAttribute;
  const ruv = rodGeo.attributes.uv as THREE.BufferAttribute;
  for (let k = 0; k < rp.count; k++) ruv.setY(k, (rp.getY(k) + rodHalf) / (2 * rodHalf));
  const rod = new THREE.Mesh(rodGeo, rodMat);
  rod.rotation.z = Math.PI / 2;
  grp.add(rod);

  // bracket outline in (depth, height): wall side at the back, rounded top, rod passing through
  const w = 0.11;
  const top = RAIL_TOP;
  const bottom = -0.075;
  const back = -0.075;
  const front = back + w;
  const rad = w / 2;
  const plate = new THREE.Shape();
  plate.moveTo(back, bottom + 0.012);
  plate.quadraticCurveTo(back, bottom, back + 0.012, bottom);
  plate.lineTo(front - 0.012, bottom);
  plate.quadraticCurveTo(front, bottom, front, bottom + 0.012);
  plate.lineTo(front, top - rad);
  plate.absarc(back + rad, top - rad, rad, 0, Math.PI, false);
  plate.lineTo(back, bottom + 0.012);
  const thick = 0.05;
  const plateGeo = new THREE.ExtrudeGeometry(plate, {
    depth: thick,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 3,
    curveSegments: 32,
  });
  plateGeo.rotateY(-Math.PI / 2);
  plateGeo.translate(thick / 2, 0, 0);
  for (const sgn of [-1, 1]) {
    const b = new THREE.Mesh(plateGeo, plateMat);
    b.position.x = sgn * bracketX;
    grp.add(b);
  }
  return grp;
}

/* ---------- the hanger: natural-wood clip hanger (slim notched arms, chrome hook, wire bar with two clips) ---------- */
// outline in px, traced from the reference photo: crown top at (0, 0), arms 2 x 318 px wide
const H_END = 312; // where the rounded arm end begins
const HANGER_HALF_PX = 318;
const NOTCH = { at: 255, w: 12, d: 10 }; // the small cut near each arm end
const WOOD_Z = 0.014; // in front of the shoulder fabric: the jacket hangs off the arms, it never covers them
const WIRE_Z = 0; // clip bar hangs inside the jacket, as on a real hanger

const hangerTopPx = (xPx: number) => {
  const x = Math.min(Math.abs(xPx), H_END);
  return x < 60 ? (x * x * 0.58) / 120 : 17.4 + 0.58 * (x - 60); // rounded crown, then a straight 30 degree arm
};
const armThickPx = (xPx: number) => 62 - 12 * (Math.min(Math.abs(xPx), H_END) / H_END);

function hangerOutline(): [number, number][] {
  const half: [number, number][] = [];
  for (let x = 0; x <= H_END; x += 3) {
    let y = hangerTopPx(x);
    const n0 = NOTCH.at - NOTCH.w / 2;
    if (x > n0 && x < n0 + NOTCH.w) y += NOTCH.d * Math.sin((Math.PI * (x - n0)) / NOTCH.w);
    half.push([x, y]);
  }
  const yt = hangerTopPx(H_END);
  const r = armThickPx(H_END) / 2;
  for (let a = -75; a <= 75; a += 15) {
    const t = (a * Math.PI) / 180;
    half.push([H_END + 6 * Math.cos(t), yt + r + r * Math.sin(t)]);
  }
  for (let x = H_END; x >= 0; x -= 6) half.push([x, hangerTopPx(x) + armThickPx(x)]);
  const left = half
    .slice()
    .reverse()
    .map(([x, y]) => [-x, y] as [number, number]);
  return [...half, ...left.slice(1, -1)];
}
const HANGER_OUTLINE = hangerOutline();

type HangerFit = { s: number; ys: number; y0: number };

/** Measure the jacket's shoulder line from its outline and size the hanger so its arms ride just along it. */
function fitHanger(width: number, height: number, df: DistField): HangerFit {
  const topAt = (frac: number) => {
    const col = clamp(Math.round((0.5 + frac) * df.w), 0, df.w - 1);
    for (let r = 0; r < df.h; r++) if (df.inside[r * df.w + col]) return -JTOP - (r / df.h) * height;
    return -JTOP - height;
  };
  const edge = (frac: number) => (topAt(frac) + topAt(-frac)) / 2;
  const s = (0.38 * width) / HANGER_HALF_PX; // arm ends land on the shoulder points
  const x1 = 0.2 * width;
  const x2 = 0.32 * width;
  const dY = hangerTopPx(x2 / s) - hangerTopPx(x1 / s);
  const ys = clamp((edge(0.2) - edge(0.32)) / s / Math.max(1, dY), 0.35, 1.3); // match the shoulder slope
  const armW = armThickPx(x2 / s) * s * ys;
  const y0 = edge(0.32) + 0.62 * armW + hangerTopPx(x2 / s) * s * ys; // lower third of the arm overlaps the shoulder
  return { s, ys, y0 };
}

function buildClip(chrome: THREE.Material) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.046, 0.007), chrome);
  const front = body.clone();
  body.position.z = -0.0045;
  front.position.z = 0.0045;
  front.position.y = -0.002;
  g.add(body, front);
  // pressed ridges on the clip face, like the reference
  for (const dx of [-0.008, 0, 0.008]) {
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.0025, 0.022, 0.002), chrome);
    ridge.position.set(dx, 0.006, 0.0085);
    g.add(ridge);
  }
  const spring = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.03, 10), chrome);
  spring.rotation.z = Math.PI / 2;
  spring.position.y = 0.014;
  g.add(spring);
  return g;
}

function buildHanger(fit: HangerFit, woodMat: THREE.Material, chrome: THREE.Material) {
  const { s, ys, y0 } = fit;
  const shape = new THREE.Shape();
  HANGER_OUTLINE.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x * s, -y * s * ys) : shape.lineTo(x * s, -y * s * ys)));
  shape.closePath();

  let wood: THREE.BufferGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.009,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 3,
    curveSegments: 4,
  });
  wood.translate(0, 0, -0.0045);
  wood.deleteAttribute('normal');
  wood.deleteAttribute('uv');
  wood = mergeVertices(wood, 1e-5);
  const pos = wood.attributes.position as THREE.BufferAttribute;
  for (let k = 0; k < pos.count; k++) {
    const sx = pos.getX(k) / (GW / 2);
    pos.setZ(k, WOOD_Z + pos.getZ(k) - 0.07 * sx * sx * 0.85); // follow the jacket's shoulder curve
  }
  wood.computeVertexNormals();

  const g = new THREE.Group();
  const body = new THREE.Mesh(wood, woodMat);
  body.position.y = y0;
  g.add(body);

  // chrome wire legs + bar with two clips
  const wire = 0.0032;
  const legX = 0.8 * HANGER_HALF_PX;
  const legTop = y0 - (hangerTopPx(legX) + armThickPx(legX) - 6) * s * ys;
  const barY = y0 - 248 * s * ys;
  const legLen = Math.max(0.02, legTop - barY);
  for (const sgn of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(wire, wire, legLen, 8), chrome);
    leg.position.set(sgn * legX * s, barY + legLen / 2, WIRE_Z);
    g.add(leg);
    const clip = buildClip(chrome);
    clip.position.set(sgn * 0.55 * legX * s, barY - 0.012, WIRE_Z);
    g.add(clip);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(wire, wire, 2 * legX * s, 8), chrome);
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, barY, WIRE_Z);
  g.add(bar);

  // chrome hook
  const stemTop = Math.min(y0 + 0.006, -0.08);
  const hookPts: [number, number][] = [
    [0, stemTop], [0, -0.07], [0.014, -0.046], [0.042, -0.024], [0.053, 0.004], [0.041, 0.038],
    [0.005, 0.056], [-0.032, 0.043], [-0.051, 0.012], [-0.049, -0.016],
  ];
  if (y0 + 0.006 < stemTop - 0.001) hookPts.unshift([0, y0 + 0.006]);
  g.add(
    new THREE.Mesh(
      new THREE.TubeGeometry(
        new THREE.CatmullRomCurve3(hookPts.map(([x, y], i) => new THREE.Vector3(x, y, i === 0 ? WOOD_Z : i === 1 ? WOOD_Z * 0.5 : 0))),
        80,
        0.0045,
        10,
        false,
      ),
      chrome,
    ),
  );
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0065, 14, 10), chrome);
  tip.position.set(-0.049, -0.016, 0);
  g.add(tip);
  return g;
}

type Hanger = {
  i: number;
  pivot: THREE.Group;
  swing: THREE.Group;
  turn: THREE.Group;
  proxy: THREE.Mesh;
  df: DistField;
  hem: number;
  intro: boolean;
  sp: { x: Spring; z: Spring; s: Spring; turn: Spring; sway: Spring };
};

export default function Rack({ items, onAdd, formatPrice, onPick, activeId }: Props) {
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tagRef = useRef<HTMLParagraphElement>(null);
  const controls = useRef<{ hover: (i: number) => void; select: (i: number) => void } | null>(null);
  const [hovered, setHovered] = useState(-1);
  const [selected, setSelected] = useState(-1);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !items.length) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let disposed = false;
    let raf = 0;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      setFailed('The 3D rail needs WebGL. Open this page in a recent version of Chrome, Safari or Firefox.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NeutralToneMapping;

    const N = items.length;
    // every jacket gets the same area, so wide bombers and long field jackets read as the same size
    const AREA = GW * 1.12;
    const sizes = items.map((it) => {
      const aspect = it.w / it.h;
      return { w: Math.sqrt(AREA * aspect), h: Math.sqrt(AREA / aspect) };
    });
    const heights = sizes.map((sz) => sz.h);
    const maxHem = JTOP + Math.max(1, ...heights);
    const span = Math.min(0.74 * N, 8.4); // each jacket gets clear air on either side
    const slotHalf = Math.max(0.6, span / 2);
    const bracketX = slotHalf + 0.2;
    const railHalf = bracketX + 0.4;
    const hoverW = N > 1 ? Math.max(1.5, (FRONT_W * (N - 1)) / Math.max(0.4, 2 * slotHalf - FRONT_W)) : 1;
    const camY = (RAIL_TOP - maxHem) / 2;
    const hNeed = (RAIL_TOP + maxHem) / 0.9;
    const wNeed = Math.max(3.6, (2 * railHalf + 0.1) / 0.94);
    const spacing = (2 * slotHalf) / N;
    // the camera frames a handful of jackets at a time and glides along the rail as the page scrolls
    const track = wrap.closest<HTMLElement>('[data-rack-track]');
    // phones: ~3 jackets in view; larger screens: ~6
    const frameW = (width: number) => (track ? Math.min(wNeed, (width < 700 ? 2.8 : 5.6) * spacing + 0.9) : wNeed);
    let camX = 0;
    let panRange = 0;
    let visibleW = 1;
    let dragX = -Infinity; // swipe position on phones (starts at the left end of the rail)
    let dragStart: { x: number; cam: number } | null = null;
    let dragged = false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    const envTex = studioEnvironment(renderer);
    scene.environment = envTex;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfccc4, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(-2.6, 3.2, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xf4f6ff, 0.5);
    fill.position.set(3.5, 0.8, 4);
    scene.add(fill);
    scene.add(buildRail(railHalf, bracketX));

    const slotX = (i: number, h: number) => {
      const k = h >= 0 ? hoverW : 1;
      const u = (slotHalf * 2) / (N - 1 + k);
      let acc = -slotHalf;
      for (let j = 0; j < i; j++) acc += (j === h ? k : 1) * u;
      return acc + ((i === h ? k : 1) * u) / 2;
    };

    let hoverIdx = -1;
    let selectIdx = -1;
    let hangers: Hanger[] = [];
    const activeIdx = () => (hoverIdx >= 0 ? hoverIdx : selectIdx);
    const layout = () => {
      const act = activeIdx();
      for (const hg of hangers) {
        const on = hg.i === act;
        hg.sp.x.t = slotX(hg.i, act);
        hg.sp.turn.t = on ? 0 : hg.intro ? REST + INTRO_TURN : REST;
        hg.sp.z.t = on ? 0.08 : 0;
        hg.sp.s.t = on ? 1.03 : 1;
      }
    };
    const hover = (i: number) => {
      if (i === hoverIdx) return;
      hoverIdx = i;
      setHovered(i);
      layout();
    };
    const select = (i: number) => {
      selectIdx = i;
      setSelected(i);
      layout();
    };
    controls.current = { hover, select };

    /* sizing: one resize per frame, follows container size, browser zoom and screen changes */
    let W = 1;
    let H = 1;
    let resizeRaf = 0;
    let dprQuery: MediaQueryList | null = null;
    const watchDpr = () => {
      dprQuery?.removeEventListener('change', onDpr);
      dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      dprQuery.addEventListener('change', onDpr);
    };
    function onDpr() {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      watchDpr();
      scheduleResize();
    }
    const scheduleResize = () => {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        resize();
        renderer.render(scene, camera); // draw at the new size right away, no stretched frame
      });
    };
    const resize = () => {
      W = Math.max(1, wrap.clientWidth);
      H = Math.max(1, wrap.clientHeight);
      renderer.setSize(W, H, false);
      const aspect = W / H;
      const t = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
      const fw = frameW(W);
      const D = Math.max(hNeed / (2 * t), fw / (aspect * 2 * t));
      camera.aspect = aspect;
      camera.position.set(camX, camY, D);
      camera.lookAt(camX, camY, 0);
      camera.updateProjectionMatrix();
      visibleW = 2 * D * t * aspect;
      panRange = Math.max(0, railHalf + 0.25 - visibleW / 2);
    };
    const ro = new ResizeObserver(scheduleResize);
    ro.observe(wrap);
    window.addEventListener('orientationchange', scheduleResize);
    watchDpr();
    resize();

    let visible = true;
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(wrap);

    /* picking */
    const ray = new THREE.Raycaster();
    ray.layers.set(1);
    const ndc = new THREE.Vector2();
    const pick = (e: PointerEvent | MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      for (const hit of ray.intersectObjects(hangers.map((h) => h.proxy), false)) {
        const hg = hangers[hit.object.userData.index as number];
        if (!hit.uv) continue;
        const x = clamp(Math.floor(hit.uv.x * hg.df.w), 0, hg.df.w - 1);
        const y = clamp(Math.floor((1 - hit.uv.y) * hg.df.h), 0, hg.df.h - 1);
        if (hg.df.inside[y * hg.df.w + x]) return hg.i;
      }
      return -1;
    };
    let leaveTimer = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const i = pick(e);
      canvas.style.cursor = i >= 0 ? 'pointer' : '';
      window.clearTimeout(leaveTimer);
      if (i >= 0) hover(i);
      else leaveTimer = window.setTimeout(() => hover(-1), 90);
    };
    const onLeave = () => {
      window.clearTimeout(leaveTimer);
      leaveTimer = window.setTimeout(() => hover(-1), 90);
    };
    const onDown = (e: PointerEvent) => {
      dragStart = { x: e.clientX, cam: clamp(dragX, -panRange, panRange) };
      dragged = false;
    };
    const onDrag = (e: PointerEvent) => {
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x;
      if (Math.abs(dx) > 6) dragged = true;
      dragX = dragStart.cam - dx * (visibleW / W);
    };
    const onUp = () => {
      dragStart = null;
    };
    const onClick = (e: MouseEvent) => {
      if (dragged) {
        dragged = false; // a swipe is not a tap
        return;
      }
      const i = pick(e);
      if (onPickRef.current) {
        if (i >= 0) {
          select(i);
          onPickRef.current(items[i]);
        }
        return;
      }
      select(i >= 0 && i !== selectIdx ? i : -1);
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onDrag);
    window.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    /* build the jackets */
    const woodMat = new THREE.MeshPhysicalMaterial({
      color: 0xdcb383,
      roughness: 0.5,
      metalness: 0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.35,
    });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.18 });
    const proxyMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });

    Promise.all(
      items.map((it) =>
        Promise.all([
          loadImg(`${BASE}rack/${it.id}.jpg`),
          loadImg(`${BASE}rack/${it.id}-mask.png`),
          it.back ? loadImg(`${BASE}rack/${it.id}-back.jpg`).catch(() => null) : Promise.resolve(null),
        ]),
      ),
    )
      .then((imgs) => {
        if (disposed) return;
        hangers = items.map((it, i) => {
          const [colorImg, maskImg, backImg] = imgs[i];
          const height = heights[i];
          const df = distField(maskImg, 128, Math.round((128 * it.h) / it.w));
          const map = new THREE.Texture(colorImg);
          map.colorSpace = THREE.SRGBColorSpace;
          map.anisotropy = 8;
          map.needsUpdate = true;
          const alphaMap = new THREE.Texture(maskImg);
          alphaMap.needsUpdate = true;
          // real back photo when there is one; otherwise a soft blur of the front reads as plain fabric
          let backMap: THREE.Texture;
          if (backImg) {
            backMap = new THREE.Texture(backImg);
            backMap.anisotropy = 8;
            backMap.needsUpdate = true;
          } else {
            const bc = document.createElement('canvas');
            bc.width = 40;
            bc.height = Math.round((40 * it.h) / it.w);
            bc.getContext('2d')!.drawImage(colorImg, 0, 0, bc.width, bc.height);
            backMap = new THREE.CanvasTexture(bc);
          }
          backMap.colorSpace = THREE.SRGBColorSpace;
          const mat = (m: THREE.Texture, shade: number) =>
            new THREE.MeshStandardMaterial({
              map: m,
              alphaMap,
              alphaTest: 0.5,
              alphaToCoverage: true,
              side: THREE.DoubleSide,
              roughness: 0.88,
              metalness: 0,
              envMapIntensity: 0.75,
              color: new THREE.Color().setScalar(shade),
            });
          const geo = buildGeo(sizes[i].w, height, df, i * 7 + 3);
          const pivot = new THREE.Group();
          const swing = new THREE.Group();
          const turn = new THREE.Group();
          pivot.add(swing);
          swing.add(turn);
          const proxy = new THREE.Mesh(new THREE.PlaneGeometry(sizes[i].w, height).translate(0, -JTOP - height / 2, 0), proxyMat);
          proxy.layers.set(1);
          proxy.userData.index = i;
          turn.add(new THREE.Mesh(geo.front, mat(map, 0.8)), new THREE.Mesh(geo.back, mat(backMap, backImg ? 0.78 : 0.62)), buildHanger(fitHanger(sizes[i].w, height, df), woodMat, chromeMat), proxy);
          scene.add(pivot);
          return {
            i,
            pivot,
            swing,
            turn,
            proxy,
            df,
            hem: -(JTOP + height),
            intro: !reduce,
            sp: {
              x: new Spring(slotX(i, -1), 180, 22, reduce),
              z: new Spring(0, 160, 24, reduce),
              s: new Spring(1, 160, 24, reduce),
              turn: new Spring(reduce ? REST : REST + INTRO_TURN, 140, 19, reduce),
              sway: new Spring(0, 55, 4.5, reduce),
            },
          };
        });
        layout();
        setReady(true);
        if (!reduce)
          hangers.forEach((hg, i) =>
            window.setTimeout(() => {
              hg.intro = false;
              layout();
            }, 350 + i * 90),
          );
      })
      .catch(() => !disposed && setFailed('The jacket photos did not load. Reload the page to try again.'));

    /* loop */
    const tmp = new THREE.Vector3();
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible) return;
      // scroll-linked pan: progress through the pinned section moves the camera from one end of the rail to the other
      if (track && panRange > 0) {
        const r = track.getBoundingClientRect();
        let target: number;
        if (r.height > window.innerHeight * 1.3) {
          // pinned layout (tablet/desktop): scroll progress drives the pan
          const progress = clamp(-r.top / Math.max(1, r.height - window.innerHeight), 0, 1);
          target = -panRange + 2 * panRange * progress;
        } else {
          // phone layout: swipe the rail sideways
          dragX = clamp(dragX, -panRange, panRange);
          target = dragX;
        }
        camX += (target - camX) * Math.min(1, dt * 9);
        camera.position.x = camX;
        camera.lookAt(camX, camY, 0);
      }
      const steps = Math.max(1, Math.ceil(dt * 120));
      const h = dt / steps;
      for (const hg of hangers) {
        const s = hg.sp;
        for (let k = 0; k < steps; k++) {
          s.x.step(h);
          s.z.step(h);
          s.s.step(h);
          s.turn.step(h);
          if (!reduce) {
            s.sway.t = clamp(-s.x.vel * 0.05, -0.12, 0.12);
            s.sway.step(h);
          }
        }
        hg.pivot.position.set(s.x.v, 0, s.z.v);
        hg.pivot.scale.setScalar(s.s.v);
        // perspective correction: offset each jacket's turn by its angle to the camera, so jackets at the ends of a
        // long rail look as full as the ones in the middle, and a hovered jacket faces the viewer squarely
        hg.turn.rotation.y = s.turn.v + Math.atan2(camera.position.x - hg.pivot.position.x, camera.position.z);
        hg.swing.rotation.z = s.sway.v;
      }
      const act = activeIdx();
      if (act >= 0 && hangers[act] && tagRef.current) {
        tmp.set(hangers[act].pivot.position.x, hangers[act].hem - 0.16, 0).project(camera);
        tagRef.current.style.transform = `translate(${((tmp.x * 0.5 + 0.5) * W).toFixed(1)}px, ${((-tmp.y * 0.5 + 0.5) * H).toFixed(1)}px) translateX(-50%)`;
      }
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(resizeRaf);
      window.clearTimeout(leaveTimer);
      ro.disconnect();
      window.removeEventListener('orientationchange', scheduleResize);
      dprQuery?.removeEventListener('change', onDpr);
      io.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onDrag);
      window.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      controls.current = null;
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material as THREE.MeshStandardMaterial;
          m.map?.dispose();
          m.alphaMap?.dispose();
          m.dispose();
        }
      });
      envTex.dispose();
      renderer.dispose();
    };
  }, [items]);

  useEffect(() => {
    if (!onPick) return;
    const i = activeId ? items.findIndex((it) => it.id === activeId) : -1;
    controls.current?.select(i);
  }, [activeId, items, onPick, ready]);

  const active = hovered >= 0 ? hovered : selected;
  const pickedItem = selected >= 0 ? items[selected] : null;

  return (
    <div className="rack">
      <div className="rack-stage" ref={wrapRef}>
        <canvas ref={canvasRef} className={ready ? 'is-ready' : ''} aria-hidden="true" />
        <p ref={tagRef} className={`rack-tag ${active >= 0 ? 'on' : ''}`} aria-hidden="true">
          {active >= 0 && `${items[active].name} · ${formatPrice(items[active].price)}`}
        </p>
        {!ready && !failed && <p className="rack-status">Hanging the rail…</p>}
        {failed && <p className="rack-status">{failed}</p>}
      </div>

      <ul className="sr-only" aria-label="Jackets on the rail">
        {items.map((it, i) => (
          <li key={it.id}>
            <button
              type="button"
              onFocus={() => controls.current?.hover(i)}
              onBlur={() => controls.current?.hover(-1)}
              onClick={() => (onPick ? onPick(it) : controls.current?.select(i))}
            >
              {it.name}, {formatPrice(it.price)}
            </button>
          </li>
        ))}
      </ul>

      <div className={`rack-panel ${pickedItem && !onPick ? 'on' : ''}`} aria-live="polite">
        {pickedItem && !onPick ? (
          <>
            <div>
              <h3>{pickedItem.name}</h3>
              <p>
                {pickedItem.material} · {formatPrice(pickedItem.price)}
              </p>
            </div>
            <div className="rack-panel-actions">
              <button type="button" className="cta cta-dark" onClick={() => onAdd(pickedItem)}>
                Add to bag
              </button>
              <button type="button" className="text-link" onClick={() => controls.current?.select(-1)}>
                Close
              </button>
            </div>
          </>
        ) : (
          <p className="rack-hint">
            <span className="hint-pointer">Hover a jacket to turn it. Click it for details.</span>
            <span className="hint-touch">Swipe the rail. Tap a jacket for details.</span>
          </p>
        )}
      </div>
    </div>
  );
}
