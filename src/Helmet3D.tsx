import { ReactNode, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { ProductView } from './ProductModal';

const BASE = import.meta.env.BASE_URL;
export const THETA = 0.56; // the middle photo is a three-quarter view, roughly 32 degrees off the front
export const DEPTH = 1.22; // helmets are longer front to back than they are wide
const MASK_W = 220;

export type Mask = {
  a: Uint8ClampedArray;
  w: number;
  h: number;
  top: number;
  bottom: number;
  rim: number; // last row of the solid shell; straps hang below it
  cx: number; // horizontal centre of the shell
  shell: number; // shell height in mask pixels
  colour: [number, number, number]; // average colour of the solid shell (0..1)
};

type Props = {
  views: ProductView[]; // front, three-quarter, back
  view: number; // which button is pressed: 0 front, 1 side, 2 back
  label: string;
  fallback: ReactNode;
};

function loadImg(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Silhouette analysis: row extents, where the solid shell ends, and its centre. */
export function analyze(img: HTMLImageElement): Mask {
  const w = MASK_W;
  const h = Math.max(1, Math.round((MASK_W * img.height) / img.width));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const a = new Uint8ClampedArray(w * h);
  for (let i = 0; i < w * h; i++) a[i] = px[i * 4 + 3];
  const colourOf = (r0: number, r1: number): [number, number, number] => {
    let cr = 0;
    let cg = 0;
    let cb = 0;
    let n = 0;
    for (let r = r0; r <= r1; r++)
      for (let x = 0; x < w; x++) {
        const i = r * w + x;
        if (px[i * 4 + 3] > 230) {
          cr += px[i * 4];
          cg += px[i * 4 + 1];
          cb += px[i * 4 + 2];
          n++;
        }
      }
    return n ? [cr / n / 255, cg / n / 255, cb / n / 255] : [0.5, 0.5, 0.5];
  };
  const rowSpan = (r: number): [number, number, number] => {
    let first = -1;
    let last = -1;
    let count = 0;
    for (let x = 0; x < w; x++)
      if (a[r * w + x] > 128) {
        if (first < 0) first = x;
        last = x;
        count++;
      }
    return [first, last, count];
  };
  let top = 0;
  while (top < h - 1 && rowSpan(top)[2] === 0) top++;
  let bottom = h - 1;
  while (bottom > top && rowSpan(bottom)[2] === 0) bottom--;
  let rim = bottom;
  for (let r = top + Math.round(0.3 * (bottom - top)); r < bottom - 2; r++) {
    const solid = (row: number) => {
      const [f, l, n] = rowSpan(row);
      return f >= 0 && n / (l - f + 1) >= 0.55;
    };
    if (!solid(r) && !solid(r + 1) && !solid(r + 2)) {
      rim = r;
      break;
    }
  }
  let sum = 0;
  let n = 0;
  for (let r = top + Math.round(0.1 * (rim - top)); r <= rim; r++) {
    const [f, l] = rowSpan(r);
    if (f >= 0) {
      sum += (f + l) / 2;
      n++;
    }
  }
  return { a, w, h, top, bottom, rim, cx: n ? sum / n : w / 2, shell: Math.max(1, rim - top), colour: colourOf(top, Math.round(top + 0.6 * (rim - top))) };
}

export function rowHalfWidth(m: Mask, row: number) {
  const r = Math.round(row);
  if (r < 0 || r >= m.h) return 0;
  let first = -1;
  let last = -1;
  for (let x = 0; x < m.w; x++)
    if (m.a[r * m.w + x] > 128) {
      if (first < 0) first = x;
      last = x;
    }
  return first < 0 ? 0 : (last - first + 1) / 2;
}

/** Oval cross-sections stacked down the front silhouette: shell on top, straps below. */
export function buildShell(front: Mask) {
  const extent = (front.bottom - front.top) / front.shell; // total height in shell units
  const ROWS = 72;
  const SEG = 80;
  const radii: number[] = [];
  for (let i = 0; i <= ROWS; i++) radii.push(rowHalfWidth(front, front.top + (i / ROWS) * extent * front.shell) / front.shell);
  const smooth = radii.map((_, i) => (radii[Math.max(0, i - 1)] + radii[i] * 2 + radii[Math.min(ROWS, i + 1)]) / 4);
  const pos: number[] = [0, 0.004, 0];
  for (let i = 0; i <= ROWS; i++) {
    const y = -(i / ROWS) * extent;
    const rx = Math.max(0.002, smooth[i]);
    for (let s = 0; s < SEG; s++) {
      const t = (s / SEG) * Math.PI * 2;
      pos.push(rx * Math.cos(t), y, rx * DEPTH * Math.sin(t));
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < SEG; s++) idx.push(0, 1 + ((s + 1) % SEG), 1 + s);
  for (let i = 0; i < ROWS; i++)
    for (let s = 0; s < SEG; s++) {
      const a = 1 + i * SEG + s;
      const b = 1 + i * SEG + ((s + 1) % SEG);
      const c = a + SEG;
      const d = b + SEG;
      idx.push(a, b, c, b, d, c);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // make sure normals point outwards (flip the winding if they don't)
  const probe = 1 + Math.round(ROWS * 0.4) * SEG;
  if ((geo.attributes.normal as THREE.BufferAttribute).getX(probe) < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  const maxR = Math.max(...smooth);
  return { geo, extent, maxR };
}

export const vertexShader = /* glsl */ `
  varying vec3 vPos;
  varying vec3 vN;
  varying vec3 vWN;
  void main() {
    vPos = position;
    vN = normal;
    vWN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// four projectors: front, three-quarter, mirrored three-quarter (the hidden side), back
export const fragmentShader = /* glsl */ `
  uniform sampler2D tFront;
  uniform sampler2D tSide;
  uniform sampler2D tBack;
  uniform vec4 mFront;
  uniform vec4 mSide;
  uniform vec4 mBack;
  uniform float uTheta;
  uniform vec3 uFallback;
  uniform vec3 uLight;
  varying vec3 vPos;
  varying vec3 vN;
  varying vec3 vWN;

  vec4 proj(sampler2D t, vec4 m, vec3 right) {
    float u = m.x * dot(vPos, right) + m.y;
    float v = m.z * vPos.y + m.w;
    if (u < 0.0 || u > 1.0 || v < 0.0 || v > 1.0) return vec4(0.0);
    return texture2D(t, vec2(u, v));
  }

  void main() {
    vec3 n = normalize(vN);
    float s = sin(uTheta);
    float c = cos(uTheta);
    vec3 dF = vec3(0.0, 0.0, 1.0);
    vec3 dS = vec3(s, 0.0, c);
    vec3 dM = vec3(-s, 0.0, c);
    vec3 dB = vec3(0.0, 0.0, -1.0);
    // sharp blend: each patch of shell comes almost entirely from the photo facing it, so logos never double up
    float wF = pow(max(dot(n, dF), 0.0), 12.0);
    float wS = pow(max(dot(n, dS), 0.0), 12.0);
    float wM = pow(max(dot(n, dM), 0.0), 12.0);
    float wB = pow(max(dot(n, dB), 0.0), 12.0) * 1.2;
    vec4 pF = proj(tFront, mFront, vec3(1.0, 0.0, 0.0));
    vec4 pS = proj(tSide, mSide, vec3(c, 0.0, -s));
    vec4 pM = proj(tSide, mSide, vec3(-c, 0.0, -s)); // mirrored photo stands in for the far side
    vec4 pB = proj(tBack, mBack, vec3(-1.0, 0.0, 0.0));
    vec3 col = wF * pF.a * pF.rgb + wS * pS.a * pS.rgb + wM * pM.a * pM.rgb + wB * pB.a * pB.rgb;
    float aw = wF * pF.a + wS * pS.a + wM * pM.a + wB * pB.a;
    float wsum = wF + wS + wM + wB;
    float alpha = aw / max(wsum, 1e-4);
    col = aw > 1e-3 ? col / aw : uFallback;
    if (vPos.y < -1.02 && alpha < 0.5) discard; // below the shell only the straps remain
    float shade = 0.84 + 0.22 * max(dot(normalize(vWN), uLight), 0.0);
    if (!gl_FrontFacing) shade *= 0.32; // inside of the shell
    gl_FragColor = vec4(col * shade, 1.0);
  }
`;

/** A 3D helmet made from three product photos. Turns slowly; drag to spin; buttons snap to an angle. */
export default function Helmet3D({ views, view, label, fallback }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const targetRef = useRef<((angle: number) => void) | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || views.length < 3) return;
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
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    const pivot = new THREE.Group();
    scene.add(pivot);
    let disposed = false;
    let raf = 0;
    let mesh: THREE.Mesh | null = null;
    let fit = 3;

    let yaw = 0;
    let yawTarget = 0;
    let autoAt = 0; // auto-rotation resumes after this time
    let drag: { x: number; yaw: number } | null = null;
    targetRef.current = (angle: number) => {
      // nearest equivalent of the requested angle, so it never spins the long way round
      const k = Math.round((yaw - angle) / (Math.PI * 2));
      yawTarget = angle + k * Math.PI * 2;
      autoAt = performance.now() + 5000;
    };

    const resize = () => {
      const w = Math.max(1, wrap.clientWidth);
      const h = Math.max(1, wrap.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const dist = fit / (2 * Math.tan(THREE.MathUtils.degToRad(14))) / Math.min(1, camera.aspect);
      camera.position.set(0, 0.25, dist);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    Promise.all(views.slice(0, 3).map((v) => loadImg(`${BASE}${v.file}`)))
      .then(([fImg, sImg, bImg]) => {
        if (disposed) return;
        const [mF, mS, mB] = [fImg, sImg, bImg].map(analyze);
        const { geo, extent, maxR } = buildShell(mF);
        const tex = (img: HTMLImageElement) => {
          const t = new THREE.Texture(img);
          t.anisotropy = 8;
          t.needsUpdate = true;
          return t;
        };
        const map = (m: Mask) => new THREE.Vector4(m.shell / m.w, m.cx / m.w, m.shell / m.h, 1 - m.top / m.h);
        const material = new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader,
          side: THREE.DoubleSide,
          uniforms: {
            tFront: { value: tex(fImg) },
            tSide: { value: tex(sImg) },
            tBack: { value: tex(bImg) },
            mFront: { value: map(mF) },
            mSide: { value: map(mS) },
            mBack: { value: map(mB) },
            uTheta: { value: THETA },
            uFallback: { value: new THREE.Vector3(...mF.colour) }, // shell colour where no photo reaches
            uLight: { value: new THREE.Vector3(-0.4, 0.8, 0.6).normalize() },
          },
        });
        mesh = new THREE.Mesh(geo, material);
        mesh.position.y = extent / 2;
        pivot.add(mesh);
        pivot.rotation.x = 0.12;
        fit = Math.max(extent, 2 * maxR * DEPTH) * 1.3;
        resize();
        setReady(true);
      })
      .catch(() => !disposed && setFailed(true));

    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, yaw: yawTarget };
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      yawTarget = drag.yaw + (e.clientX - drag.x) * 0.012;
      autoAt = performance.now() + 2500;
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
      if (!reduce && !drag && now > autoAt) yawTarget += dt * 0.45;
      yaw += (yawTarget - yaw) * Math.min(1, dt * (drag ? 18 : 6));
      pivot.rotation.y = yaw;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      if (mesh) {
        mesh.geometry.dispose();
        const m = mesh.material as THREE.ShaderMaterial;
        ['tFront', 'tSide', 'tBack'].forEach((k) => (m.uniforms[k].value as THREE.Texture).dispose());
        m.dispose();
      }
      renderer.dispose();
      targetRef.current = null;
    };
  }, [views]);

  // Front / Side / Back buttons: Side shows the three-quarter photo's angle
  useEffect(() => {
    targetRef.current?.([0, -THETA, Math.PI][view] ?? 0);
  }, [view]);

  if (failed) return <>{fallback}</>;
  return (
    <div className="helmet3d" ref={wrapRef}>
      {!ready && <div className="helmet3d-fallback">{fallback}</div>}
      <canvas ref={canvasRef} className={ready ? 'is-ready' : ''} role="img" aria-label={`${label}, 3D view. Drag to turn.`} />
    </div>
  );
}
