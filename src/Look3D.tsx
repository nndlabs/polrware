import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { JTOP, buildGeo, distField, loadImg, studioEnvironment } from './Rack';
import { THETA, analyze, buildShell, fragmentShader, rowHalfWidth, vertexShader, type Mask } from './Helmet3D';
import type { JacketDetail } from './ProductModal';

const BASE = import.meta.env.BASE_URL;

/* body measurements in metres: a 1.85 m mannequin, head about 1/8 of the height */
const BODY = {
  headY: 1.68,
  headTop: 1.8,
  shoulderY: 1.5,
  hipY: 0.95,
  legX: 0.092,
  footX: 0.1,
};

type Props = {
  jacket?: JacketDetail;
  helmet?: JacketDetail;
  boots?: JacketDetail;
  label: string;
};

type Api = {
  setJacket: (item?: JacketDetail) => void;
  setHelmet: (item?: JacketDetail) => void;
  setBoots: (item?: JacketDetail) => void;
};

const viewFile = (item: JacketDetail, label: string) => item.views?.find((v) => v.label === label)?.file;

/* ---------- mannequin ---------- */
function lathe(profile: [number, number][], segments = 48) {
  return new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
}

function buildMannequin(form: THREE.Material, trousers: THREE.Material) {
  const g = new THREE.Group();
  const torso = new THREE.Mesh(
    lathe([
      [0.001, BODY.hipY - 0.02],
      [0.15, BODY.hipY - 0.01],
      [0.168, BODY.hipY + 0.06],
      [0.15, 1.1],
      [0.142, 1.16],
      [0.165, 1.3],
      [0.178, 1.38],
      [0.172, 1.44],
      [0.145, 1.49],
      [0.1, 1.525],
      [0.058, 1.545],
      [0.001, 1.548],
    ]),
    form,
  );
  torso.scale.set(1, 1, 0.64); // flatter front to back than side to side
  g.add(torso);

  const hips = new THREE.Mesh(
    lathe([
      [0.001, BODY.hipY - 0.015],
      [0.156, BODY.hipY - 0.005],
      [0.174, BODY.hipY + 0.06],
      [0.158, 1.1],
      [0.149, 1.13],
      [0.001, 1.131],
    ]),
    trousers,
  );
  hips.scale.set(1, 1, 0.66);
  g.add(hips);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.1, 24), form);
  neck.position.y = 1.595;
  g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28), form);
  head.scale.set(0.09, 0.118, 0.106);
  head.position.y = BODY.headY;
  g.add(head);

  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(
      lathe([
        [0.001, BODY.hipY + 0.03],
        [0.082, BODY.hipY + 0.02],
        [0.078, 0.78],
        [0.06, 0.52],
        [0.056, 0.44],
        [0.05, 0.2],
        [0.044, 0.08],
        [0.001, 0.07],
      ]),
      trousers,
    );
    leg.position.x = side * BODY.legX;
    g.add(leg);
  }

  // arms: only shown when no jacket is worn (the jacket's sleeves stand in for them)
  const arms = new THREE.Group();
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.5, 6, 16), form);
    arm.position.set(side * 0.235, 1.2, 0);
    arm.rotation.z = side * 0.09;
    arms.add(arm);
  }
  g.add(arms);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(0.4, 0.42, 0.035, 64),
    new THREE.MeshStandardMaterial({ color: 0xe9e8e3, roughness: 0.7 }),
  );
  platform.position.y = -0.018;
  g.add(platform);
  return { group: g, arms };
}

/* ---------- photo-projected material (shared by helmets and boots) ---------- */
function projected(images: HTMLImageElement[], masks: Mask[], theta: number, fallback: [number, number, number]) {
  const tex = (img: HTMLImageElement) => {
    const t = new THREE.Texture(img);
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  };
  const map = (m: Mask) => new THREE.Vector4(m.shell / m.w, m.cx / m.w, m.shell / m.h, 1 - m.top / m.h);
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    uniforms: {
      tFront: { value: tex(images[0]) },
      tSide: { value: tex(images[1]) },
      tBack: { value: tex(images[2]) },
      mFront: { value: map(masks[0]) },
      mSide: { value: map(masks[1]) },
      mBack: { value: map(masks[2]) },
      uTheta: { value: theta },
      uFallback: { value: new THREE.Vector3(...fallback) },
      uLight: { value: new THREE.Vector3(-0.4, 0.8, 0.6).normalize() },
    },
  });
}

/* ---------- boots: a hull from the front (width) and side (length, height) silhouettes ---------- */
function rowExtent(m: Mask, row: number): [number, number] | null {
  const r = Math.round(row);
  if (r < 0 || r >= m.h) return null;
  let first = -1;
  let last = -1;
  for (let x = 0; x < m.w; x++)
    if (m.a[r * m.w + x] > 128) {
      if (first < 0) first = x;
      last = x;
    }
  return first < 0 ? null : [first, last];
}

function bootMask(m: Mask): Mask {
  // whole boot is "shell": height = top to sole, centred on the silhouette's overall middle
  let lo = m.w;
  let hi = 0;
  for (let r = m.top; r <= m.bottom; r++) {
    const e = rowExtent(m, r);
    if (e) {
      lo = Math.min(lo, e[0]);
      hi = Math.max(hi, e[1]);
    }
  }
  return { ...m, rim: m.bottom, shell: Math.max(1, m.bottom - m.top), cx: (lo + hi) / 2 };
}

function buildBoot(front: Mask, side: Mask) {
  const ROWS = 48;
  const SEG = 64;
  const N = 3; // superellipse exponent: boxier than an oval, like a boot
  const pos: number[] = [];
  let lastRing: { hx: number; zc: number; hz: number } = { hx: 0.2, zc: 0, hz: 0.5 };
  const se = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), 2 / N);
  for (let i = 0; i <= ROWS; i++) {
    const t = i / ROWS;
    const y = -t;
    const hx = rowHalfWidth(front, front.top + t * front.shell) / front.shell;
    const e = rowExtent(side, side.top + t * side.shell);
    const ring = e
      ? { hx: Math.max(0.03, hx), zc: (side.cx - (e[0] + e[1]) / 2) / side.shell, hz: Math.max(0.03, (e[1] - e[0]) / 2 / side.shell) }
      : lastRing;
    lastRing = ring;
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * Math.PI * 2;
      pos.push(ring.hx * se(Math.cos(a)), y, ring.zc + ring.hz * se(Math.sin(a)));
    }
  }
  const top = pos.length / 3;
  pos.push(0, 0, (side.cx - side.cx) / side.shell);
  const bottom = top + 1;
  pos.push(0, -1, lastRing.zc);
  const idx: number[] = [];
  for (let i = 0; i < ROWS; i++)
    for (let s = 0; s < SEG; s++) {
      const a = i * SEG + s;
      const b = i * SEG + ((s + 1) % SEG);
      idx.push(a, b, a + SEG, b, b + SEG, a + SEG);
    }
  for (let s = 0; s < SEG; s++) {
    idx.push(top, (s + 1) % SEG, s);
    idx.push(bottom, ROWS * SEG + s, ROWS * SEG + ((s + 1) % SEG));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const probe = Math.round(ROWS * 0.6) * SEG; // angle 0 points along +x
  if ((geo.attributes.normal as THREE.BufferAttribute).getX(probe) < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  return geo;
}

function disposeTree(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        Object.values(m).forEach((v) => v instanceof THREE.Texture && v.dispose());
        if (m instanceof THREE.ShaderMaterial) Object.values(m.uniforms).forEach((u) => u.value instanceof THREE.Texture && u.value.dispose());
        m.dispose();
      }
    }
  });
}

/** The 3D dressing scene: mannequin plus whichever jacket, helmet and boots are picked. Drag to turn. */
export default function Look3D({ jacket, helmet, boots, label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const api = useRef<Api | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    const env = studioEnvironment(renderer);
    scene.environment = env;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d3cc, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-2, 3.5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xeef3ff, 0.6);
    rim.position.set(2.5, 2, -3);
    scene.add(rim);

    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 30);
    const pivot = new THREE.Group();
    scene.add(pivot);
    const form = new THREE.MeshStandardMaterial({ color: 0xdcd7ce, roughness: 0.55, metalness: 0 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x3c3f43, roughness: 0.85, metalness: 0 });
    const { group: mannequin, arms } = buildMannequin(form, trousers);
    pivot.add(mannequin);

    const slots: Record<'jacket' | 'helmet' | 'boots', THREE.Group | null> = { jacket: null, helmet: null, boots: null };
    const tokens = { jacket: 0, helmet: 0, boots: 0 };
    const place = (slot: keyof typeof slots, obj: THREE.Group | null) => {
      if (slots[slot]) {
        pivot.remove(slots[slot]!);
        disposeTree(slots[slot]!);
      }
      slots[slot] = obj;
      if (obj) pivot.add(obj);
      arms.visible = !slots.jacket;
    };

    api.current = {
      setJacket: (item) => {
        const tok = ++tokens.jacket;
        if (!item) return place('jacket', null);
        Promise.all([
          loadImg(`${BASE}rack/${item.id}.jpg`),
          loadImg(`${BASE}rack/${item.id}-mask.png`),
          item.back ? loadImg(`${BASE}rack/${item.id}-back.jpg`).catch(() => null) : Promise.resolve(null),
        ]).then(([colorImg, maskImg, backImg]) => {
          if (tok !== tokens.jacket || disposed) return;
          const width = 0.66;
          const height = (width * item.h) / item.w;
          const df = distField(maskImg, 128, Math.round((128 * item.h) / item.w));
          const geo = buildGeo(width, height, df, 7);
          const alphaMap = new THREE.Texture(maskImg);
          alphaMap.needsUpdate = true;
          const map = new THREE.Texture(colorImg);
          map.colorSpace = THREE.SRGBColorSpace;
          map.anisotropy = 8;
          map.needsUpdate = true;
          const back = new THREE.Texture(backImg ?? colorImg);
          back.colorSpace = THREE.SRGBColorSpace;
          back.needsUpdate = true;
          const mat = (m: THREE.Texture, shade: number) =>
            new THREE.MeshStandardMaterial({
              map: m,
              alphaMap,
              alphaTest: 0.5,
              side: THREE.DoubleSide,
              roughness: 0.88,
              envMapIntensity: 0.7,
              color: new THREE.Color().setScalar(shade),
            });
          const g = new THREE.Group();
          g.add(new THREE.Mesh(geo.front, mat(map, 0.82)), new THREE.Mesh(geo.back, mat(back, backImg ? 0.8 : 0.6)));
          g.scale.set(1, 1, 2.4); // wrap the padded panels around the torso
          g.position.y = 1.585 + JTOP;
          place('jacket', g);
        });
      },
      setHelmet: (item) => {
        const tok = ++tokens.helmet;
        const views = item?.views;
        if (!item || !views || views.length < 3) return place('helmet', null);
        Promise.all(views.slice(0, 3).map((v) => loadImg(`${BASE}${v.file}`))).then((imgs) => {
          if (tok !== tokens.helmet || disposed) return;
          const masks = imgs.map(analyze);
          const { geo } = buildShell(masks[0]);
          const mesh = new THREE.Mesh(geo, projected(imgs, masks, THETA, masks[0].colour));
          const g = new THREE.Group();
          g.add(mesh);
          g.scale.setScalar(0.165); // shell height in metres
          g.position.y = BODY.headTop + 0.035;
          place('helmet', g);
        });
      },
      setBoots: (item) => {
        const tok = ++tokens.boots;
        if (!item) return place('boots', null);
        const files = ['Front', 'Side', 'Back'].map((l) => viewFile(item, l));
        if (files.some((f) => !f)) return place('boots', null);
        Promise.all(files.map((f) => loadImg(`${BASE}${f}`))).then((imgs) => {
          if (tok !== tokens.boots || disposed) return;
          const masks = imgs.map((img) => bootMask(analyze(img)));
          const geo = buildBoot(masks[0], masks[1]);
          const g = new THREE.Group();
          for (const sideX of [-1, 1]) {
            const mesh = new THREE.Mesh(geo, projected(imgs, masks, Math.PI / 2, analyze(imgs[1]).colour));
            mesh.scale.set(sideX < 0 ? -0.2 : 0.2, 0.2, 0.2); // 20 cm tall; mirrored for the left foot
            mesh.position.set(sideX * BODY.footX, 0.2, 0.025);
            g.add(mesh);
          }
          place('boots', g);
        });
      },
    };

    const resize = () => {
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const fitH = 2.02;
      const fitW = 1.0;
      const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const dist = Math.max(fitH / (2 * t), fitW / (2 * t * camera.aspect));
      camera.position.set(0, 1.05, dist);
      camera.lookAt(0, 0.93, 0);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    let disposed = false;
    let raf = 0;
    let yaw = 0;
    let yawTarget = 0;
    let autoAt = 0;
    let drag: { x: number; yaw: number } | null = null;
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, yaw: yawTarget };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      yawTarget = drag.yaw + (e.clientX - drag.x) * 0.012;
      autoAt = performance.now() + 3000;
    };
    const onUp = () => {
      drag = null;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // gentle sway between three-quarter left and right rather than a full spin, so the front stays readable
      if (!reduce && !drag && now > autoAt) yawTarget = Math.sin(now / 3200) * 0.55;
      yaw += (yawTarget - yaw) * Math.min(1, dt * (drag ? 16 : 3));
      pivot.rotation.y = yaw;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);
    setReady(true);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      disposeTree(scene);
      env.dispose();
      renderer.dispose();
      api.current = null;
    };
  }, []);

  useEffect(() => api.current?.setJacket(jacket), [jacket, ready]);
  useEffect(() => api.current?.setHelmet(helmet), [helmet, ready]);
  useEffect(() => api.current?.setBoots(boots), [boots, ready]);

  if (failed) return <p className="lk-loading">The 3D mannequin needs WebGL. Open this page in a recent browser.</p>;
  return (
    <div className="lk-3d" ref={wrapRef}>
      <canvas ref={canvasRef} className={ready ? 'is-ready' : ''} role="img" aria-label={label} />
    </div>
  );
}
