import { KINDS, KIND_LABEL, COLORS, DIRS, POINT_KINDS, defaults, newId, type El, type Kind, type Scene } from './schema';
import { renderElement, renderSVG, P, screenDeltaToAB, screenToAB, setProjection, ISO } from './iso';
import { gridLines } from './grid';
import { griddedImage, imageToJpeg, loadImage } from './grid';
import { runAI, describeError, getKey, setKey, aiMode } from './ai';
import { askConfirm, saveFile } from './platform';
import { setBusy } from './busy';
import sampleScene from './sample-scene.json';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const NS = 'http://www.w3.org/2000/svg';
const STORE = 'iso-drafter:scene';

// ---------------------------------------------------------------- state
let scene: Scene = { width: 2210, height: 2736, elements: [] };
let underUrl: string | null = null;
let underImg: HTMLImageElement | null = null;
let selId: string | null = null;
let wscale = 1.35;
const undo: string[] = [];
const redo: string[] = [];
let view = { x: 0, y: 0, w: 2210, h: 2736 };
let aiAbort: AbortController | null = null;

const stage = $('stage') as unknown as SVGSVGElement;
const sceneLayer = $('sceneLayer') as unknown as SVGGElement;
const selLayer = $('selLayer') as unknown as SVGGElement;
const gridLayer = $('gridLayer') as unknown as SVGGElement;
const under = $('under') as unknown as SVGImageElement;
const paper = $('paper') as unknown as SVGRectElement;

const snap = (v: number, free = false) => (free ? Math.round(v) : Math.round(v / 5) * 5);
const selected = () => scene.elements.find((e) => e.id === selId) ?? null;
const ensureIds = (els: El[]) => els.map((e) => ({ ...e, id: e.id ?? newId() }));

// ---------------------------------------------------------------- history / persistence
const snapshot = () => JSON.stringify(scene);
function commit(before: string) {
  if (before === snapshot()) return;
  undo.push(before); if (undo.length > 200) undo.shift();
  redo.length = 0;
  save();
}
function save() { try { localStorage.setItem(STORE, snapshot()); } catch { /* 용량 초과 등 */ } }
function restore(s: string) { scene = JSON.parse(s); scene.elements = ensureIds(scene.elements); if (!selected()) selId = null; fullRender(); save(); }

// ---------------------------------------------------------------- status
function status(msg: string, kind: '' | 'busy' | 'err' = '') {
  $('status').textContent = msg;
  const bar = document.querySelector('.status')!;
  bar.classList.toggle('busy', kind === 'busy');
  bar.classList.toggle('err', kind === 'err');
}

// ---------------------------------------------------------------- rendering
function setView() { stage.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`); }
function fitView() {
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return;          // 에디터가 숨겨져 있을 때
  const k = Math.min(r.width / scene.width, r.height / scene.height) * 0.96;
  view.w = r.width / k; view.h = r.height / k;
  view.x = (scene.width - view.w) / 2; view.y = (scene.height - view.h) / 2;
  setView();
}

function renderGrid() {
  gridLayer.innerHTML = '';
  if (!($('chkGrid') as HTMLInputElement).checked) return;
  const { width: W, height: H } = scene;
  const gl = gridLines(W, H, 50);
  const d1 = gl.A.map(([, x0, y0, x1, y1]) => `M${x0} ${y0}L${x1} ${y1}`).join('');
  const d2 = gl.B.map(([, x0, y0, x1, y1]) => `M${x0} ${y0}L${x1} ${y1}`).join('');
  gridLayer.innerHTML = `<path d="${d1}" stroke="#f08080" stroke-width="1" opacity=".45" fill="none"/>` +
    `<path d="${d2}" stroke="#8080f0" stroke-width="1" opacity=".45" fill="none"/>`;
}

function renderOne(e: El) {
  let g = sceneLayer.querySelector<SVGGElement>(`g[data-id="${e.id}"]`);
  if (!g) { g = document.createElementNS(NS, 'g'); g.dataset.id = e.id!; sceneLayer.appendChild(g); }
  g.innerHTML = renderElement(e, wscale);
}

function fullRender() {
  setProjection(scene.proj ?? ISO);
  paper.setAttribute('width', String(scene.width)); paper.setAttribute('height', String(scene.height));
  under.setAttribute('width', String(scene.width)); under.setAttribute('height', String(scene.height));
  if (underUrl) under.setAttribute('href', underUrl); else under.removeAttribute('href');
  under.style.opacity = String(+($('rngUnder') as HTMLInputElement).value / 100);
  sceneLayer.innerHTML = '';
  for (const e of scene.elements) renderOne(e);
  renderGrid();
  renderLayers();
  renderSelection();
  renderProps();
}

// ---------------------------------------------------------------- selection overlay + handles
type Handle = { x: number; y: number; apply: (e: El, dA: number, dB: number, dZ: number, free: boolean, orig: El) => void };

function handlesFor(e: El): Handle[] {
  const hs: Handle[] = [];
  const pt = (a: number, b: number, z: number) => { const [x, y] = P(a, b, z); return { x, y }; };
  if (POINT_KINDS.has(e.kind)) {
    e.points.forEach((q, i) => hs.push({ ...pt(q.a, q.b, q.z), apply: (el, dA, dB, _dz, fr, o) => {
      el.points[i] = { ...o.points[i], a: snap(o.points[i].a + dA, fr), b: snap(o.points[i].b + dB, fr) };
    } }));
    return hs;
  }
  const pointKinds: Kind[] = ['chair', 'taskChair', 'stool', 'monitor', 'laptop', 'node'];
  if (pointKinds.includes(e.kind) && Math.abs(e.a1 - e.a0) < 1 && Math.abs(e.b1 - e.b0) < 1) return hs;
  const base = e.kind === 'slab' ? e.z : e.z;
  hs.push({ ...pt(e.a0, e.b0, base), apply: (el, dA, dB, _dz, fr, o) => { el.a0 = snap(o.a0 + dA, fr); el.b0 = snap(o.b0 + dB, fr); } });
  hs.push({ ...pt(e.a1, e.b1, base), apply: (el, dA, dB, _dz, fr, o) => { el.a1 = snap(o.a1 + dA, fr); el.b1 = snap(o.b1 + dB, fr); } });
  if (e.kind !== 'slab') {
    const ca = (e.a0 + e.a1) / 2, cb = (e.b0 + e.b1) / 2;
    hs.push({ ...pt(ca, cb, e.z + e.h), apply: (el, _a, _b, dZ, fr, o) => { el.h = Math.max(0, snap(o.h + dZ, fr)); } });
  }
  return hs;
}

function footprint(e: El): string {
  const pts: [number, number][] = [];
  if (POINT_KINDS.has(e.kind)) e.points.forEach((q) => pts.push(P(q.a, q.b, q.z)));
  else if (['chair', 'taskChair', 'stool', 'monitor', 'laptop', 'node'].includes(e.kind) && Math.abs(e.a1 - e.a0) < 1 && Math.abs(e.b1 - e.b0) < 1) {
    const r = e.kind === 'node' ? 34 : 18;
    for (const [da, db] of [[-r, -r], [r, -r], [r, r], [-r, r]]) pts.push(P(e.a0 + da, e.b0 + db, e.z));
  } else if (['glass', 'rail', 'door'].includes(e.kind)) {
    pts.push(P(e.a0, e.b0, e.z), P(e.a1, e.b1, e.z), P(e.a1, e.b1, e.z + e.h), P(e.a0, e.b0, e.z + e.h));
  } else {
    const z = e.kind === 'slab' ? e.z : e.z;
    pts.push(P(e.a0, e.b0, z), P(e.a1, e.b0, z), P(e.a1, e.b1, z), P(e.a0, e.b1, z));
  }
  const closed = e.kind !== 'route';
  return 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + (closed ? 'Z' : '');
}

function renderSelection() {
  selLayer.innerHTML = '';
  const e = selected();
  if (!e) return;
  const px = view.w / (stage.getBoundingClientRect().width || view.w);     // 화면 1px의 장면 단위
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', footprint(e));
  path.setAttribute('fill', 'rgba(47,107,255,.08)');
  path.setAttribute('stroke', '#2f6bff');
  path.setAttribute('stroke-width', String(1.5 * px));
  path.setAttribute('stroke-dasharray', `${6 * px} ${4 * px}`);
  path.style.pointerEvents = 'none';
  selLayer.appendChild(path);
  handlesFor(e).forEach((h, i) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('cx', String(h.x)); c.setAttribute('cy', String(h.y)); c.setAttribute('r', String(6 * px));
    c.setAttribute('fill', '#fff'); c.setAttribute('stroke', '#2f6bff'); c.setAttribute('stroke-width', String(2 * px));
    c.dataset.handle = String(i);
    c.style.cursor = 'crosshair';
    selLayer.appendChild(c);
  });
}

// ---------------------------------------------------------------- layers list
function renderLayers() {
  const ol = $('layers');
  ol.innerHTML = '';
  scene.elements.forEach((e) => {
    const li = document.createElement('li');
    li.className = e.id === selId ? 'on' : '';
    li.innerHTML = `<span class="k"></span><span class="n"></span>`;
    li.querySelector('.k')!.textContent = KIND_LABEL[e.kind];
    li.querySelector('.n')!.textContent = e.note && e.note !== KIND_LABEL[e.kind] ? e.note : '';
    li.onclick = () => select(e.id!);
    ol.appendChild(li);
  });
  ol.querySelector('li.on')?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- properties panel
const DIR_LABEL: Record<string, string> = { '+a': '+A (오른쪽 아래)', '-a': '−A (왼쪽 위)', '+b': '+B (오른쪽 위)', '-b': '−B (왼쪽 아래)' };
const COLOR_LABEL: Record<string, string> = { white: '흰색', green: '초록', greenStrip: '연초록 띠', greenGlass: '초록 유리', gray: '회색/불투명' };

function renderProps() {
  const box = $('props');
  const e = selected();
  if (!e) { box.innerHTML = '<p class="empty">요소를 선택하면 여기서 수치를 편집할 수 있어요.<br><br>좌표는 등각 격자 기준이에요. A는 오른쪽 아래, B는 오른쪽 위, z와 h는 높이예요.</p>'; return; }
  const num = (k: keyof El, label: string) =>
    `<label class="field"><span>${label}</span><input type="number" step="5" data-k="${String(k)}" value="${(e[k] as number) ?? 0}"></label>`;
  const usesPts = POINT_KINDS.has(e.kind);
  box.innerHTML = `
    <div class="props-head"><b>${KIND_LABEL[e.kind]}</b><select data-k="kind">${KINDS.map((k) => `<option value="${k}" ${k === e.kind ? 'selected' : ''}>${KIND_LABEL[k]}</option>`).join('')}</select></div>
    <div class="fields">
      ${usesPts ? '' : num('a0', 'A0') + num('b0', 'B0') + num('a1', 'A1') + num('b1', 'B1')}
      ${num('z', 'z (바닥 위 높이)')}${num('h', 'h (높이/두께)')}
      ${num('n', 'n (칸·단·문살)')}${num('m', 'm (열)')}
      <label class="field"><span>방향</span><select data-k="dir">${DIRS.map((d) => `<option value="${d}" ${d === e.dir ? 'selected' : ''}>${DIR_LABEL[d]}</option>`).join('')}</select></label>
      <label class="field"><span>색</span><select data-k="color">${COLORS.map((c) => `<option value="${c}" ${c === e.color ? 'selected' : ''}>${COLOR_LABEL[c]}</option>`).join('')}</select></label>
      ${usesPts ? `<label class="field wide"><span>점 목록 (한 줄에 A, B, z)</span><textarea data-k="points">${e.points.map((q) => `${q.a}, ${q.b}, ${q.z}`).join('\n')}</textarea></label>` : ''}
      <label class="field wide"><span>메모</span><input data-k="note" value=""></label>
    </div>
    <div class="actions">
      <button class="btn" data-act="dup">복제</button>
      <button class="btn" data-act="back">뒤로</button>
      <button class="btn" data-act="front">앞으로</button>
      <button class="btn" data-act="toBack">맨 뒤</button>
      <button class="btn" data-act="toFront">맨 앞</button>
      <button class="btn danger" data-act="del">삭제</button>
    </div>`;
  (box.querySelector('[data-k=note]') as HTMLInputElement).value = e.note;
  box.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-k]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const before = snapshot();
      const k = inp.dataset.k as keyof El;
      const el = selected(); if (!el) return;
      if (k === 'points') {
        el.points = inp.value.split('\n').map((l) => l.split(/[,\s]+/).filter(Boolean).map(Number))
          .filter((v) => v.length >= 2 && v.every((x) => !Number.isNaN(x))).map(([a, b, z = 0]) => ({ a, b, z }));
      } else if (k === 'kind') {
        Object.assign(el, { ...defaults(inp.value as Kind), ...pickGeom(el), kind: inp.value as Kind, id: el.id, note: el.note });
      } else if (['dir', 'color', 'note'].includes(k)) {
        (el as Record<string, unknown>)[k] = inp.value;
      } else {
        const v = parseFloat(inp.value); if (Number.isNaN(v)) return;
        (el as Record<string, unknown>)[k] = v;
      }
      renderOne(el); renderSelection(); renderLayers(); if (k === 'kind') renderProps();
      commit(before);
    });
  });
  box.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.dataset.act!)));
}
const pickGeom = (e: El) => ({ a0: e.a0, a1: e.a1, b0: e.b0, b1: e.b1, z: e.z });

function act(name: string) {
  const e = selected(); if (!e) return;
  const before = snapshot();
  const els = scene.elements, i = els.indexOf(e);
  if (name === 'del') { els.splice(i, 1); selId = null; }
  else if (name === 'dup') {
    const c: El = JSON.parse(JSON.stringify(e)); c.id = newId();
    c.a0 += 20; c.a1 += 20; c.points = c.points.map((q) => ({ ...q, a: q.a + 20 }));
    els.splice(i + 1, 0, c); selId = c.id!;
  }
  else if (name === 'back' && i > 0) [els[i - 1], els[i]] = [els[i], els[i - 1]];
  else if (name === 'front' && i < els.length - 1) [els[i + 1], els[i]] = [els[i], els[i + 1]];
  else if (name === 'toBack') { els.splice(i, 1); els.unshift(e); }
  else if (name === 'toFront') { els.splice(i, 1); els.push(e); }
  fullRender();
  commit(before);
}

function select(id: string | null) {
  selId = id;
  renderLayers(); renderSelection(); renderProps();
}

// ---------------------------------------------------------------- add buttons
function addElement(kind: Kind) {
  const before = snapshot();
  const e = defaults(kind);
  e.id = newId();
  // 현재 화면 중앙의 차트 좌표로 옮긴다
  const [ca, cb] = screenToAB(view.x + view.w / 2, view.y + view.h / 2);
  const da = snap(ca - (e.a0 + e.a1) / 2), db = snap(cb - (e.b0 + e.b1) / 2);
  e.a0 += da; e.a1 += da; e.b0 += db; e.b1 += db;
  e.points = e.points.map((q) => ({ ...q, a: q.a + da, b: q.b + db }));
  scene.elements.push(e);
  selId = e.id;
  fullRender();
  commit(before);
}
const addGrid = $('addGrid');
for (const k of KINDS) {
  const b = document.createElement('button');
  b.className = 'btn'; b.textContent = KIND_LABEL[k];
  b.onclick = () => addElement(k);
  addGrid.appendChild(b);
}

// ---------------------------------------------------------------- pointer interaction
function toScene(ev: PointerEvent | WheelEvent) {
  const r = stage.getBoundingClientRect();
  return { x: view.x + ((ev.clientX - r.left) / r.width) * view.w, y: view.y + ((ev.clientY - r.top) / r.height) * view.h };
}

type Drag =
  | { mode: 'pan'; sx: number; sy: number; vx: number; vy: number }
  | { mode: 'move' | 'handle'; start: { x: number; y: number }; orig: El; before: string; handle?: Handle };
let drag: Drag | null = null;

stage.addEventListener('pointerdown', (ev) => {
  if (ev.button === 1 || ev.button === 0) {
    const t = ev.target as Element;
    const hIdx = (t as SVGElement).dataset?.handle;
    const g = t.closest('g[data-id]') as SVGGElement | null;
    const p = toScene(ev);
    if (hIdx !== undefined && selected() && ev.button === 0) {
      const e = selected()!;
      drag = { mode: 'handle', start: p, orig: JSON.parse(JSON.stringify(e)), before: snapshot(), handle: handlesFor(e)[+hIdx] };
    } else if (g && ev.button === 0) {
      if (g.dataset.id !== selId) select(g.dataset.id!);
      drag = { mode: 'move', start: p, orig: JSON.parse(JSON.stringify(selected())), before: snapshot() };
    } else {
      if (ev.button === 0 && !g) select(null);
      drag = { mode: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y };
      stage.classList.add('panning');
    }
    stage.setPointerCapture(ev.pointerId);
  }
});

stage.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (drag.mode === 'pan') {
    const r = stage.getBoundingClientRect();
    view.x = drag.vx - ((ev.clientX - drag.sx) / r.width) * view.w;
    view.y = drag.vy - ((ev.clientY - drag.sy) / r.height) * view.h;
    setView();
    return;
  }
  const e = selected(); if (!e) return;
  const p = toScene(ev), dx = p.x - drag.start.x, dy = p.y - drag.start.y;
  const [dA, dB] = screenDeltaToAB(dx, dy);
  const free = ev.altKey, o = drag.orig;
  if (drag.mode === 'move') {
    const sa = snap(dA, free), sb = snap(dB, free);
    Object.assign(e, { a0: o.a0 + sa, a1: o.a1 + sa, b0: o.b0 + sb, b1: o.b1 + sb, points: o.points.map((q) => ({ ...q, a: q.a + sa, b: q.b + sb })) });
  } else if (drag.handle) {
    drag.handle.apply(e, dA, dB, -dy, free, o);
  }
  renderOne(e); renderSelection();
});

function endDrag() {
  if (!drag) return;
  if (drag.mode !== 'pan') { commit(drag.before); renderProps(); }
  stage.classList.remove('panning');
  drag = null;
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

stage.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const p = toScene(ev), k = Math.exp(ev.deltaY * 0.0012);
  view.x = p.x - (p.x - view.x) * k; view.y = p.y - (p.y - view.y) * k;
  view.w *= k; view.h *= k;
  setView(); renderSelection();
}, { passive: false });

window.addEventListener('keydown', (ev) => {
  const tag = (ev.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z' && !ev.shiftKey) { ev.preventDefault(); doUndo(); }
  else if ((ev.ctrlKey || ev.metaKey) && (ev.key.toLowerCase() === 'y' || (ev.key.toLowerCase() === 'z' && ev.shiftKey))) { ev.preventDefault(); doRedo(); }
  else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'd') { ev.preventDefault(); act('dup'); }
  else if (ev.key === 'Delete' || ev.key === 'Backspace') act('del');
  else if (ev.key === 'Escape') select(null);
  else if (ev.key.startsWith('Arrow') && selected()) {
    ev.preventDefault();
    const e = selected()!, before = snapshot(), s = ev.shiftKey ? 25 : 5;
    const [da, db] = ({ ArrowRight: [s, 0], ArrowLeft: [-s, 0], ArrowUp: [0, s], ArrowDown: [0, -s] } as Record<string, [number, number]>)[ev.key];
    e.a0 += da; e.a1 += da; e.b0 += db; e.b1 += db; e.points = e.points.map((q) => ({ ...q, a: q.a + da, b: q.b + db }));
    renderOne(e); renderSelection(); renderProps(); commit(before);
  }
});

function doUndo() { const s = undo.pop(); if (!s) return; redo.push(snapshot()); restore(s); }
function doRedo() { const s = redo.pop(); if (!s) return; undo.push(snapshot()); restore(s); }
$('btnUndo').onclick = doUndo;
$('btnRedo').onclick = doRedo;

// ---------------------------------------------------------------- top bar
($('rngUnder') as HTMLInputElement).oninput = (ev) => { under.style.opacity = String(+(ev.target as HTMLInputElement).value / 100); };
($('chkGrid') as HTMLInputElement).onchange = renderGrid;
($('rngStroke') as HTMLInputElement).oninput = (ev) => { wscale = +(ev.target as HTMLInputElement).value / 100; for (const e of scene.elements) renderOne(e); };

($('fileImage') as HTMLInputElement).onchange = async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
  const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
  const img = await loadImage(url);
  const before = snapshot();
  underUrl = url; underImg = img;
  const sizeChanged = img.naturalWidth !== scene.width || img.naturalHeight !== scene.height;
  scene.width = img.naturalWidth; scene.height = img.naturalHeight;
  if (sizeChanged && scene.elements.length && !(await askConfirm('새 이미지의 크기가 지금 장면과 달라요. 장면을 그대로 둘까요?', '그대로 두기', '장면 비우기'))) scene.elements = [];
  fullRender(); fitView(); commit(before);
  status(`밑그림: ${file.name} (${img.naturalWidth}×${img.naturalHeight}). ‘AI 초안’으로 시작하거나 왼쪽에서 요소를 직접 추가하세요.`);
  (ev.target as HTMLInputElement).value = '';
};

$('btnSample').onclick = async () => {
  const before = snapshot();
  const data = sampleScene as Scene;
  scene = { ...data, elements: ensureIds(data.elements) };
  selId = null; fullRender(); fitView(); commit(before);
  status('예시 장면을 불러왔어요. 요소를 클릭해서 움직여 보세요.');
};

$('btnClear').onclick = async () => {
  if (scene.elements.length && !(await askConfirm('장면을 비울까요? 되돌리기로 복구할 수 있어요.', '비우기'))) return;
  const before = snapshot(); scene.elements = []; selId = null; fullRender(); commit(before);
};

$('btnSvg').onclick = () => saveFile('iso-drawing.svg', renderSVG(scene, { wscale }), 'image/svg+xml');
$('btnJson').onclick = () => saveFile('iso-scene.json', JSON.stringify({ ...scene, elements: scene.elements.map(({ id: _id, ...e }) => e) }, null, 1), 'application/json');
($('fileJson') as HTMLInputElement).onchange = async (ev) => {
  const file = (ev.target as HTMLInputElement).files?.[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text()) as Scene;
    const before = snapshot();
    scene = { width: data.width || scene.width, height: data.height || scene.height, elements: ensureIds(data.elements ?? []) };
    selId = null; fullRender(); fitView(); commit(before);
  } catch { status('JSON을 읽지 못했어요.', 'err'); }
  (ev.target as HTMLInputElement).value = '';
};

// ---------------------------------------------------------------- API key dialog
const dlg = $('dlgKey') as HTMLDialogElement;
export function openKeyDialog() { ($('inpKey') as HTMLInputElement).value = getKey(); dlg.showModal(); }
$('btnKey').onclick = openKeyDialog;
dlg.addEventListener('close', () => {
  if (dlg.returnValue === 'save') { setKey(($('inpKey') as HTMLInputElement).value.trim()); status('API 키를 저장했어요(이 브라우저에만).'); }
  if (dlg.returnValue === 'clear') { setKey(''); status('API 키를 지웠어요.'); }
  window.dispatchEvent(new CustomEvent('iso:key'));
});

// ---------------------------------------------------------------- AI
async function ai(refine: boolean) {
  if (!underImg) { status('먼저 ‘이미지 열기’로 원본을 올려 주세요.', 'err'); return; }
  if (!(await aiMode())) { $('btnKey').click(); return; }
  if (refine && !scene.elements.length) { status('보정할 장면이 없어요. 먼저 ‘AI 초안’을 만들어 주세요.', 'err'); return; }
  const btns = ['btnDraft', 'btnRefine'].map((id) => $(id) as HTMLButtonElement);
  btns.forEach((b) => (b.disabled = true));
  $('btnCancel').hidden = false;
  aiAbort = new AbortController();
  setBusy(0.05, 0.9);
  const t0 = performance.now();
  try {
    status('이미지를 준비하는 중…', 'busy');
    const original = await imageToJpeg(underImg);
    const overlay = refine ? renderSVG(scene, { wscale: 2, bg: null }) : null;
    const { dataUrl: gridded } = await griddedImage(underImg, overlay);
    const els = await runAI({
      original, gridded, width: scene.width, height: scene.height, base: underImg, overlaySvg: overlay,
      current: refine ? scene.elements : undefined,
      onProgress: (m) => status(`${m} (${Math.round((performance.now() - t0) / 1000)}초)`, 'busy'),
      signal: aiAbort.signal,
    });
    const before = snapshot();
    scene.elements = ensureIds(els);
    selId = null; fullRender(); commit(before);
    status(`${refine ? 'AI 보정' : 'AI 초안'} 완료: 요소 ${els.length}개 (${Math.round((performance.now() - t0) / 1000)}초). 어긋난 부분은 드래그로 맞추거나 ‘AI 보정’을 한 번 더 눌러 보세요. 되돌리기로 이전 상태로 갈 수 있어요.`);
  } catch (err) {
    status(describeError(err), 'err');
  } finally {
    btns.forEach((b) => (b.disabled = false));
    $('btnCancel').hidden = true;
    aiAbort = null;
    setBusy(null);
  }
}
$('btnDraft').onclick = async () => {
  if (scene.elements.length && !(await askConfirm('AI 초안이 지금 장면을 대체해요. 되돌리기로 복구할 수 있어요.', '초안 만들기'))) return;
  void ai(false);
};
$('btnRefine').onclick = () => void ai(true);
$('btnCancel').onclick = () => aiAbort?.abort();

// ---------------------------------------------------------------- 변환 화면과의 연결
/** 변환 결과(장면 + 교정된 원본)를 에디터에 연다. */
export async function loadIntoEditor(sc: Scene, url: string | null) {
  scene = { width: sc.width, height: sc.height, elements: ensureIds(sc.elements), proj: sc.proj };
  underUrl = url; underImg = url ? await loadImage(url) : null;
  selId = null; undo.length = 0; redo.length = 0; save();
  fullRender(); fitView();
  status('변환 결과를 불러왔어요. 어긋난 요소를 클릭해서 드래그하거나 오른쪽에서 수치를 고치세요.');
}
export const showEditorFit = () => { fitView(); renderSelection(); };
export const editorScene = () => scene;
$('btnBack').onclick = () => window.dispatchEvent(new CustomEvent('iso:back'));

// ---------------------------------------------------------------- boot
try {
  const saved = localStorage.getItem(STORE);
  if (saved) { const s = JSON.parse(saved) as Scene; scene = { ...s, elements: ensureIds(s.elements) }; }
} catch { /* 저장된 장면 없음 */ }
fullRender();
fitView();
window.addEventListener('resize', () => { fitView(); renderSelection(); });
if (!scene.elements.length) status('‘이미지 열기’로 원본을 올리거나 ‘예시 불러오기’로 둘러보세요.');
