// 변환 화면: 업로드 → 투시 교정(워커) → AI 초안 → AI 자가 보정 N회 → 결과.
import { loadIntoEditor, openKeyDialog, showEditorFit } from './main';
import { runAI, describeError, aiMode, hostedInClaude } from './ai';
import { saveFile } from './platform';
import { setBusy } from './busy';
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
type Stats = { lines: number; before: number; after: number };

// 단계별 예상 시간(초). 구독 호출 기준 관측치에 여유를 둔 범위.
const ETA = { rect: [5, 20], draft: [90, 240], fix: [60, 180], done: [1, 2] } as const;
const etaOf = (k: string): readonly [number, number] => (k === 'rect' ? ETA.rect : k === 'draft' ? ETA.draft : k === 'done' ? ETA.done : ETA.fix);
const fmt = (sec: number) => (sec < 60 ? `${Math.round(sec)}초` : `${Math.floor(sec / 60)}분${Math.round(sec % 60) ? ` ${Math.round(sec % 60)}초` : ''}`);
const fmtRange = ([a, b]: readonly [number, number]) => (b < 60 ? `${a}~${b}초` : `${Math.round(a / 60 * 2) / 2}~${Math.round(b / 60 * 2) / 2}분`);

let stepKeys: StepKey[] = [];
let curStep: StepKey | null = null;
let stepT0 = 0;
let lastSignal = 0;          // AI에서 마지막으로 소식이 온 시각
let lastMsg = '';
let ticker: number | undefined;

function setSteps(keys: StepKey[], rounds: number) {
  stepKeys = keys;
  const label = (k: StepKey) => (k === 'rect' ? '투시 교정' : k === 'draft' ? 'AI 해석 · 재작도' : k === 'done' ? '마무리' : `AI 자가 보정 ${k.slice(3)}/${rounds}`);
  $('steps').innerHTML = keys.map((k) => `<li data-k="${k}"><span class="t">${label(k)}</span><span class="eta">예상 ${fmtRange(etaOf(k))}</span></li>`).join('');
}
function li(k: StepKey) { return $('steps').querySelector<HTMLLIElement>(`li[data-k="${k}"]`); }

function mark(k: StepKey, state: 'now' | 'done' | 'fail') {
  const el = li(k);
  if (el) el.className = state;
  if (state === 'now') { curStep = k; stepT0 = performance.now(); lastSignal = stepT0; tick(); }
  if (state === 'done' && el) { el.querySelector('.eta')!.textContent = `${fmt((performance.now() - stepT0) / 1000)} 걸림`; curStep = null; }
  if (state === 'fail') { if (el) el.querySelector('.eta')!.textContent = '여기서 멈춤'; curStep = null; setBusy(null); return; }
  const i = stepKeys.indexOf(k);
  const w = stepKeys.map((x) => etaOf(x)[1]);
  const total = w.reduce((a, b) => a + b, 0);
  const start = w.slice(0, i).reduce((a, b) => a + b, 0);
  if (k === 'done' && state === 'done') setBusy(null);
  else if (state === 'done') setBusy((start + w[i]) / total);
  else setBusy((start + w[i] * 0.03) / total, (start + w[i] * 0.95) / total);
}

/** 1초마다: 현재 단계 경과/예상, 남은 전체 시간, 조용한 구간 안내 */
function tick() {
  const now = performance.now();
  if (curStep) {
    const el = li(curStep), sec = (now - stepT0) / 1000, [lo, hi] = etaOf(curStep);
    if (el) el.querySelector('.eta')!.textContent = `${fmt(sec)} 경과 · 예상 ${fmtRange([lo, hi])}`;
    const rest = stepKeys.slice(stepKeys.indexOf(curStep) + 1).filter((k) => li(k)?.className !== 'done');
    const remLo = Math.max(0, lo - sec) + rest.reduce((a, k) => a + etaOf(k)[0], 0);
    const remHi = Math.max(10, hi - sec) + rest.reduce((a, k) => a + etaOf(k)[1], 0);
    $('etaTotal').textContent = `남은 예상 시간 ${fmtRange([Math.round(remLo), Math.round(remHi)])}`;
    const quiet = (now - lastSignal) / 1000;
    $('runMsg').textContent = lastMsg + (curStep !== 'rect' && quiet > 15
      ? `\nClaude가 생각하는 동안에는 화면 변화가 없어도 정상이에요(${fmt(quiet)}째). 이 탭을 닫거나 새로고침하지 마세요.`
      : '');
  }
}
function startTicker() { clearInterval(ticker); ticker = window.setInterval(tick, 1000); }
function stopTicker() { clearInterval(ticker); ticker = undefined; $('etaTotal').textContent = ''; }

const msg = (t: string) => { lastMsg = t; lastSignal = performance.now(); $('runMsg').textContent = t; };

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
  return c2.toDataURL('image/jpeg', 0.92);
}

async function rectify(img: HTMLImageElement): Promise<{ url: string; stats: Stats }> {
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

async function aiPass(current: El[] | null, label: string): Promise<El[]> {
  const original = await imageToJpeg(rectImg!);
  const overlay = current ? renderSVG({ width: rectImg!.naturalWidth, height: rectImg!.naturalHeight, elements: current }, { wscale: 2, bg: null }) : null;
  const { dataUrl: gridded } = await griddedImage(rectImg!, overlay);
  return runAI({
    original, gridded, width: rectImg!.naturalWidth, height: rectImg!.naturalHeight,
    current: current ?? undefined, base: rectImg!, overlaySvg: overlay,
    onProgress: (m) => msg(`${label}: ${m}`),
    signal: abort!.signal,
  });
}

// ---------------------------------------------------------------- 작업(단계별 저장 → 실패·새로고침 후 이어서)
type Job = { rounds: number; rectUrl: string | null; stats: Stats; els: El[] | null; done: StepKey[]; t0: number };
const JOB_KEY = 'iso-drafter:job';
let job: Job | null = null;
const saveJob = () => { try { localStorage.setItem(JOB_KEY, JSON.stringify(job)); } catch { /* 용량 초과 등: 이어하기만 안 됨 */ } };
const loadJob = (): Job | null => { try { const v = localStorage.getItem(JOB_KEY); return v ? (JSON.parse(v) as Job) : null; } catch { return null; } };
const clearJob = () => { try { localStorage.removeItem(JOB_KEY); } catch { /* 무시 */ } };

const keysFor = (rounds: number): StepKey[] => ['rect', 'draft', ...Array.from({ length: rounds }, (_, i) => `fix${i + 1}` as StepKey), 'done'];

async function convert(file: File) {
  if (!(await aiMode())) { openKeyDialog(); return; }
  const rounds = +($('selRounds') as HTMLSelectElement).value;
  const srcUrl = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(file); });
  job = { rounds, rectUrl: null, stats: { lines: 0, before: 0, after: 0 }, els: null, done: [], t0: Date.now() };
  await runJob(srcUrl);
}

/** 남은 단계를 순서대로 실행한다. 이미 끝난 단계는 건너뛴다. */
async function runJob(srcUrl?: string) {
  if (!job) return;
  if (!(await aiMode())) { openKeyDialog(); return; }
  abort = new AbortController();
  const keys = keysFor(job.rounds);
  setSteps(keys, job.rounds);
  for (const k of job.done) mark(k, 'done'), li(k)!.querySelector('.eta')!.textContent = '완료';
  $('btnResume').hidden = true;
  ($('btnStop') as HTMLButtonElement).textContent = '중단';
  show('run');
  startTicker();
  if (job.rectUrl) { rectUrl = job.rectUrl; rectImg = await loadImage(job.rectUrl); }
  ($('runImg') as HTMLImageElement).src = job.els ? '' : (job.rectUrl ?? srcUrl ?? '');
  if (job.els) showPreview(job.els);
  let step: StepKey = 'rect';
  try {
    for (const k of keys) {
      if (job.done.includes(k)) continue;
      step = k; mark(k, 'now');
      if (k === 'rect') {
        if (!srcUrl) throw new Error('원본 이미지가 없어요. 이미지를 다시 올려 주세요.');
        const { url, stats } = await rectify(await loadImage(srcUrl));
        job.rectUrl = url; job.stats = stats;
        rectUrl = url; rectImg = await loadImage(url);
        ($('runImg') as HTMLImageElement).src = url;
      } else if (k === 'draft') {
        job.els = await aiPass(null, 'AI 해석');
        showPreview(job.els);
      } else if (k !== 'done') {
        job.els = await aiPass(job.els, `보정 ${k.slice(3)}/${job.rounds}`);
        showPreview(job.els);
      }
      mark(k, 'done');
      job.done.push(k); saveJob();
    }
    clearJob();
    finish(job.els!, job.stats, Math.round((Date.now() - job.t0) / 1000));
  } catch (err) {
    mark(step, 'fail');
    const aborted = (err as Error)?.name === 'AbortError' || abort?.signal.aborted;
    msg(aborted ? '중단했어요. 끝난 단계는 저장돼 있어요.' : `${describeError(err)}\n끝난 단계는 저장돼 있어서 이 단계부터 다시 할 수 있어요.`);
    $('btnResume').hidden = !job.rectUrl;
    ($('btnStop') as HTMLButtonElement).textContent = '처음으로';
  } finally {
    abort = null;
    stopTicker();
    setBusy(null);
  }
}

function offerResume() {
  const saved = loadJob();
  $('resumeBox').hidden = !saved?.rectUrl;
  if (saved?.rectUrl) {
    const total = keysFor(saved.rounds).length;
    $('resumeText').textContent = `지난 변환이 중간에 멈췄어요 (${total}단계 중 ${saved.done.length}단계 완료).`;
  }
}
$('btnResumeJob').onclick = () => { job = loadJob(); $('resumeBox').hidden = true; void runJob(); };
$('btnDiscardJob').onclick = () => { clearJob(); $('resumeBox').hidden = true; };
$('btnResume').onclick = () => void runJob();

/** 진행 중에도 지금까지의 재작도를 미리 보여 준다. */
function showPreview(els: El[]) {
  if (!rectImg) return;
  const svg = renderSVG({ width: rectImg.naturalWidth, height: rectImg.naturalHeight, elements: els });
  if (svgUrl) URL.revokeObjectURL(svgUrl);
  svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  ($('runImg') as HTMLImageElement).src = svgUrl;
}

function finish(els: El[], stats: Stats, secs: number) {
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
  else { ($('btnStop') as HTMLButtonElement).textContent = '중단'; offerResume(); show(result ? 'result' : 'upload'); }
};
$('btnResSvg').onclick = () => {
  if (!result) return;
  void saveFile('iso-drawing.svg', renderSVG(result), 'image/svg+xml');
};
$('btnResEdit').onclick = async () => { if (result) { await loadIntoEditor(result, rectUrl); show('editor'); } };
$('btnResNew').onclick = () => { offerResume(); show('upload'); };
$('btnResMore').onclick = async () => {
  if (!result || !rectImg) return;
  if (!(await aiMode())) { openKeyDialog(); return; }
  abort = new AbortController();
  const t0 = Date.now();
  setSteps(['fix1', 'done'], 1);
  li('fix1')!.querySelector('.t')!.textContent = 'AI 자가 보정';
  ($('runImg') as HTMLImageElement).src = svgUrl ?? '';
  $('btnResume').hidden = true;
  show('run');
  startTicker();
  try {
    mark('fix1', 'now');
    const els = await aiPass(result.elements, '추가 보정');
    mark('fix1', 'done'); mark('done', 'done');
    finish(els, { lines: 0, before: 0, after: 0 }, Math.round((Date.now() - t0) / 1000));
  } catch (err) {
    mark('fix1', 'fail');
    msg((err as Error)?.name === 'AbortError' ? '중단했어요.' : describeError(err));
    ($('btnStop') as HTMLButtonElement).textContent = '돌아가기';
  } finally { abort = null; stopTicker(); setBusy(null); }
};

void keyState();
offerResume();
show('upload');
