// 변환 화면: 업로드 → 투시 교정(워커) → AI 초안 → AI 자가 보정 N회 → 결과.
import { loadIntoEditor, openKeyDialog, showEditorFit } from './main';
import { runAI, describeError, aiMode, hostedInClaude } from './ai';
import { saveFile } from './platform';
import { rectifyRGBA, readyCv } from './convert/rectify.js';
import { griddedImage, imageToJpeg, loadImage } from './grid';
import { renderSVG } from './iso';
import { newId, type El, type Scene } from './schema';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

type View = 'upload' | 'run' | 'result' | 'editor';
function show(v: View) {
  $('convertView').hidden = v === 'editor';
  $('editorView').hidden = v !== 'editor';
  $('stepUpload').hidden = v !== 'upload';
  $('stepRun').hidden = v !== 'run';
  $('stepResult').hidden = v !== 'result';
  if (v === 'editor') requestAnimationFrame(showEditorFit);
}

// ---------------------------------------------------------------- state
let rectUrl: string | null = null;          // 투시 교정된 원본(dataURL)
let rectImg: HTMLImageElement | null = null;
let result: Scene | null = null;
let abort: AbortController | null = null;
let svgUrl: string | null = null;

async function keyState() {
  const mode = await aiMode();
  $('btnKey2').hidden = mode === 'subscription';
  $('keyState').innerHTML = mode === 'subscription'
    ? 'Claude 구독으로 실행돼요 · 처음 한 번 사용 허용 창이 떠요'
    : mode === 'key'
      ? 'API 키 설정됨 · 변환 1회에 대략 1~2달러(보정 2회 기준)'
      : hostedInClaude()
        ? 'Claude 연결을 확인하는 중이에요…'
        : 'AI 변환에는 Anthropic API 키가 필요해요 · <a href="#" id="lnkKey">키 넣기</a>';
  document.getElementById('lnkKey')?.addEventListener('click', (e) => { e.preventDefault(); openKeyDialog(); });
}
window.addEventListener('iso:key', () => void keyState());
window.addEventListener('iso:back', () => show(result ? 'result' : 'upload'));
$('btnKey2').onclick = openKeyDialog;
$('btnOpenEditor').onclick = () => show('editor');

// ---------------------------------------------------------------- steps UI
type StepKey = 'rect' | 'draft' | `fix${number}` | 'done';
function setSteps(rounds: number) {
  const items: [StepKey, string][] = [['rect', '투시 교정'], ['draft', 'AI 해석 · 재작도']];
  for (let i = 1; i <= rounds; i++) items.push([`fix${i}`, `AI 자가 보정 ${i}/${rounds}`]);
  items.push(['done', '마무리']);
  $('steps').innerHTML = items.map(([k, t]) => `<li data-k="${k}">${t}</li>`).join('');
}
function mark(k: StepKey, state: 'now' | 'done' | 'fail') {
  const li = $('steps').querySelector<HTMLLIElement>(`li[data-k="${k}"]`);
  if (li) li.className = state;
}
const msg = (t: string) => { $('runMsg').textContent = t; };

// ---------------------------------------------------------------- perspective correction (worker)
const OPENCV_CDN = 'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@5.0.0-release.1/dist/opencv.js';
let cvGlobal: Promise<unknown> | null = null;
/** claude.ai 아티팩트: 허용된 CDN에서 OpenCV를 불러와 메인 스레드에서 쓴다 */
function loadCvFromCdn() {
  return (cvGlobal ??= new Promise<unknown>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = OPENCV_CDN; s.async = true;
    s.onload = () => resolve(readyCv((window as unknown as { cv: unknown }).cv));
    s.onerror = () => { cvGlobal = null; reject(new Error('OpenCV를 불러오지 못했어요. 네트워크를 확인해 주세요.')); };
    document.head.appendChild(s);
  }));
}

function imageRGBA(img: HTMLImageElement) {
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth; cv.height = img.naturalHeight;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, cv.width, cv.height);
}
function rgbaToUrl(data: ArrayBuffer, w: number, h: number) {
  const c2 = document.createElement('canvas');
  c2.width = w; c2.height = h;
  c2.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
  return c2.toDataURL('image/png');
}

async function rectify(img: HTMLImageElement): Promise<{ url: string; stats: { lines: number; before: number; after: number } }> {
  if (hostedInClaude()) {
    msg('OpenCV를 불러오는 중… (처음 한 번은 몇 초 걸려요)');
    const cv = await loadCvFromCdn();
    const id = imageRGBA(img);
    const r = await rectifyRGBA(cv, id.data.buffer, id.width, id.height, msg);
    return { url: rgbaToUrl(r.data, r.width, r.height), stats: r.stats };
  }
  return new Promise((resolve, reject) => {
    const id = imageRGBA(img);
    const w = new Worker(new URL('./convert/worker.js', import.meta.url), { type: 'module' });
    abort?.signal.addEventListener('abort', () => { w.terminate(); reject(new DOMException('중단', 'AbortError')); });
    w.onmessage = (ev) => {
      const d = ev.data;
      if (d.type === 'progress') msg(d.stage);
      else if (d.type === 'error') { w.terminate(); reject(new Error(`투시 교정 실패: ${d.message}`)); }
      else if (d.type === 'done') {
        w.terminate();
        resolve({ url: rgbaToUrl(d.data, d.width, d.height), stats: d.stats });
      }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(`투시 교정 실패: ${e.message}`)); };
    w.postMessage({ data: id.data.buffer, width: id.width, height: id.height }, [id.data.buffer]);
  });
}

// ---------------------------------------------------------------- AI passes
const withIds = (els: El[]) => els.map((e) => ({ ...e, id: newId() }));

async function aiPass(current: El[] | null, label: string, t0: number): Promise<El[]> {
  const original = await imageToJpeg(rectImg!);
  const overlay = current ? renderSVG({ width: rectImg!.naturalWidth, height: rectImg!.naturalHeight, elements: current }, { wscale: 2, bg: null }) : null;
  const { dataUrl: gridded } = await griddedImage(rectImg!, overlay);
  return runAI({
    original, gridded, width: rectImg!.naturalWidth, height: rectImg!.naturalHeight,
    current: current ?? undefined,
    onProgress: (m) => msg(`${label}: ${m} · ${Math.round((performance.now() - t0) / 1000)}초`),
    signal: abort!.signal,
  });
}

async function convert(file: File) {
  if (!(await aiMode())) { openKeyDialog(); return; }
  const rounds = +($('selRounds') as HTMLSelectElement).value;
  abort = new AbortController();
  const t0 = performance.now();
  setSteps(rounds);
  show('run');
  const srcUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
  ($('runImg') as HTMLImageElement).src = srcUrl;
  let step: StepKey = 'rect';
  try {
    mark('rect', 'now');
    const { url, stats } = await rectify(await loadImage(srcUrl));
    rectUrl = url; rectImg = await loadImage(url);
    ($('runImg') as HTMLImageElement).src = url;
    mark('rect', 'done');

    step = 'draft'; mark('draft', 'now');
    let els = await aiPass(null, 'AI 해석', t0);
    showPreview(els);
    mark('draft', 'done');

    for (let i = 1; i <= rounds; i++) {
      step = `fix${i}`; mark(step, 'now');
      els = await aiPass(els, `보정 ${i}/${rounds}`, t0);
      showPreview(els);
      mark(step, 'done');
    }
    step = 'done'; mark('done', 'done');
    finish(els, stats, Math.round((performance.now() - t0) / 1000));
  } catch (err) {
    mark(step, 'fail');
    const aborted = (err as Error)?.name === 'AbortError' || abort?.signal.aborted;
    msg(aborted ? '중단했어요.' : describeError(err));
    ($('btnStop') as HTMLButtonElement).textContent = '처음으로';
  } finally {
    abort = null;
  }
}

/** 진행 중에도 지금까지의 재작도를 미리 보여 준다. */
function showPreview(els: El[]) {
  if (!rectImg) return;
  const svg = renderSVG({ width: rectImg.naturalWidth, height: rectImg.naturalHeight, elements: els });
  if (svgUrl) URL.revokeObjectURL(svgUrl);
  svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  ($('runImg') as HTMLImageElement).src = svgUrl;
}

function finish(els: El[], stats: { lines: number; before: number; after: number }, secs: number) {
  result = { width: rectImg!.naturalWidth, height: rectImg!.naturalHeight, elements: withIds(els) };
  renderResult();
  $('resStats').textContent =
    `요소 ${els.length}개 · ${secs}초` +
    (stats.lines ? ` · 투시 오차 ${stats.before.toFixed(1)}° → ${stats.after.toFixed(1)}° (직선 ${stats.lines}개 기준)` : '');
  show('result');
}

function renderResult() {
  if (!result) return;
  const svg = renderSVG(result);
  if (svgUrl) URL.revokeObjectURL(svgUrl);
  svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  ($('resSvg') as HTMLImageElement).src = svgUrl;
  ($('resUnder') as HTMLImageElement).src = rectUrl ?? '';
  applyCompare();
}
function applyCompare() {
  const v = +($('rngCompare') as HTMLInputElement).value / 100;
  $('resSvg').style.opacity = String(1 - v * 0.75);
  $('resUnder').style.opacity = String(v);
}
($('rngCompare') as HTMLInputElement).oninput = applyCompare;

// ---------------------------------------------------------------- buttons
const fileInput = $('fileConvert') as HTMLInputElement;
fileInput.onchange = () => { const f = fileInput.files?.[0]; fileInput.value = ''; if (f) void convert(f); };
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault(); drop.classList.remove('over');
  const f = e.dataTransfer?.files?.[0];
  if (f && f.type.startsWith('image/')) void convert(f);
});
$('btnStop').onclick = () => {
  if (abort) abort.abort();
  else { ($('btnStop') as HTMLButtonElement).textContent = '중단'; show(result ? 'result' : 'upload'); }
};
$('btnResSvg').onclick = () => {
  if (!result) return;
  void saveFile('iso-drawing.svg', renderSVG(result), 'image/svg+xml');
};
$('btnResEdit').onclick = async () => { if (result) { await loadIntoEditor(result, rectUrl); show('editor'); } };
$('btnResNew').onclick = () => show('upload');
$('btnResMore').onclick = async () => {
  if (!result || !rectImg) return;
  if (!(await aiMode())) { openKeyDialog(); return; }
  abort = new AbortController();
  const t0 = performance.now();
  $('steps').innerHTML = '<li data-k="fix1">AI 자가 보정</li><li data-k="done">마무리</li>';
  ($('runImg') as HTMLImageElement).src = svgUrl ?? '';
  show('run');
  try {
    mark('fix1', 'now');
    const els = await aiPass(result.elements, '추가 보정', t0);
    mark('fix1', 'done'); mark('done', 'done');
    finish(els, { lines: 0, before: 0, after: 0 }, Math.round((performance.now() - t0) / 1000));
  } catch (err) {
    mark('fix1', 'fail');
    msg((err as Error)?.name === 'AbortError' ? '중단했어요.' : describeError(err));
    ($('btnStop') as HTMLButtonElement).textContent = '돌아가기';
  } finally { abort = null; }
};

void keyState();
show('upload');
