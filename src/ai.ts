// Claude로 원본 이미지를 읽어 장면 데이터(초안)를 만들거나, 현재 장면을 원본에 맞게 보정한다.
// API 키는 사용자의 브라우저(localStorage)에만 저장되고 Anthropic API로 직접 전송된다.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { SceneSchema, KINDS, DIRS, COLORS, type El } from './schema';
import { getSample, inClaude } from './platform';
import { renderRegion, splitRegions, type Rect } from './grid';
import { C, S } from './iso';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `You convert an image of an isometric architectural / interior drawing into a scene description for an isometric line-drawing renderer. The renderer redraws the scene as a clean technical illustration: exact isometric axes, uniform ink lines, flat fills, green circulation route.

COORDINATES
- The second image is the original with an isometric grid. Red lines are constant-A lines, blue lines are constant-B lines, every 50 units; purple labels "A,B" mark grid crossings every 100 units. Read every position off this grid.
- Screen mapping: X = 0.866*(A+B), Y = 0.5*(A-B) - z. +A runs down-right on screen, +B runs up-right, z is up. The viewer looks from the +A / -B side, so the visible vertical faces of a box are its B0 face (lower-left) and its A1 face (lower-right).
- A point h units above grid point (A,B) appears on the grid at (A-h, B+h). Use this to find the ground position of tall things from their tops.
- Chart-frame convention (important, keeps multi-level buildings simple): give every floor the A,B coordinates its top surface visibly occupies on the grid and z = 0. Everything standing on that floor (walls, furniture, routes, nodes) also uses z = 0 and the coordinates read at its foot on that floor. Do not try to model true storey heights. Use z > 0 only for an item raised relative to the floor it visually stands on (e.g. a monitor on a desk: z = desk height).

ELEMENTS (fill every field; unused numbers = 0, unused points = [], note = short description)
- slab: floor plate, top face rectangle a0..a1 x b0..b1, thickness h (12-30). color white or green.
- floor: flat colored area drawn on a floor, polygon "points" (z = 0). Use for green carpets/rooms (color green) and corridor strips (color greenStrip).
- wall: opaque box a0..a1 x b0..b1 (thickness ~10-16), height h. color white (or green for a green feature wall).
- glass: vertical glass panel from (a0,b0) to (a1,b1) - axis-aligned, one of A or B constant - height h, n = number of mullions. color white (clear), green (green-tinted), gray (opaque white panel).
- rail: low glass balustrade like glass, h 90-120, n posts.
- door: empty door frame from (a0,b0) to (a1,b1), height h.
- shaft: translucent green vertical shaft / elevator, footprint a0..a1 x b0..b1, from z up h (h may be large to span levels: measure it from its visible screen height). Draws a dashed green centre line.
- table: desk/table footprint a0..a1 x b0..b1, height h (72-110).
- chair, taskChair (office chair, dark seat): footprint a0..a1 x b0..b1 = the seat as measured on the grid (usually 18-35 units); dir = direction the sitter faces (+a,-a,+b,-b).
- stool: bar stool, footprint = seat as measured, height h (55-75).
- sofa: footprint a0..a1 x b0..b1; dir +b/-b = back along the B1 edge, +a/-a = back along the A0 edge.
- roundTable: footprint a0..a1 x b0..b1 (diameter), height h.
- shelf: bookcase box a0..a1 x b0..b1, height h, n rows, m columns; dir -b = open face on the B0 side, +a = open face on the A1 side (only these two faces are visible; use them).
- monitor: footprint = the screen width as measured (a0..a1 or b0..b1 along the screen), z = desk height; dir +a/-a = screen spans along A, +b/-b = along B.
- laptop: footprint as measured, z = table height.
- plant: potted plant, footprint = foliage width as measured, h = total height. Output EVERY plant separately (planter rows: one plant element per visible plant).
- box: any small box-like object - crate, carton on a shelf, cabinet, counter, appliance, printer, locker, planter box, robot body. Footprint and height as measured; color white unless clearly green.
- stairs: footprint a0..a1 x b0..b1, total drop h (the floor it descends from is h above the base), n steps, dir = descending direction. Base coordinates are those of the lower floor.
- route: green circulation line, "points" polyline (axis-aligned segments wherever the image shows corners; follow stairs with straight diagonal segments).
- node: route marker circle, centre (a0,b0).

DRAW ORDER: the renderer paints elements in array order (painter's algorithm). Output back-to-front: lower/farther floors before nearer ones; within a floor: slab, floor colors, back walls, furniture from far (small A, large B) to near, front glass/rails, then shafts, then routes, then nodes last.

QUALITY - DENSITY AND TRUE SIZE (most important):
- Match the original's level of detail. Every individual object the image shows becomes its own element: each chair, each monitor, each laptop, each plant, each box on a shelf rack, each cabinet, each door frame, each glass panel run, each rail. Never summarise a group ("a row of desks") as one bigger element, and never skip small objects. A detailed office drawing usually needs 150-400 elements; a band of it 60-200.
- True size: measure every footprint by reading the grid at the object's actual corners. Do not enlarge objects, do not round sizes up, do not make furniture chunkier than drawn. Small things stay small (chairs ~20-35, monitors ~25-45 wide in typical drawings - but always trust your measurement over these hints). Snap to multiples of 5 only when that changes a size by less than 10%.
- Keep spacing: rows of chairs/desks keep the original count and pitch.
- Straighten anything the source drew slightly off-axis.`;

export function getKey() { try { return localStorage.getItem('iso-drafter:key') ?? ''; } catch { return ''; } }
export function setKey(k: string) { try { localStorage.setItem('iso-drafter:key', k); } catch { /* 저장 불가 환경 */ } }

const b64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

export type Progress = (msg: string) => void;

export async function runAI(opts: {
  original: string; gridded: string; width: number; height: number;
  current?: El[]; onProgress?: Progress; signal?: AbortSignal;
  base?: HTMLImageElement; overlaySvg?: string | null;   // 구독 경로: 구역별로 잘라 보낸다
}): Promise<El[]> {
  if (await getSample()) return runSample(opts);
  const key = getKey();
  if (!key) throw new Error('API 키가 없어요. 오른쪽 위 ⚙에서 키를 먼저 넣어 주세요.');
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true });

  const refine = !!opts.current?.length;
  const text = refine
    ? `Image size: ${opts.width} x ${opts.height} px. The second image now also shows the CURRENT scene drawn in red on top of the original. ` +
      `Here is the current scene JSON:\n${JSON.stringify({ elements: opts.current!.map(({ id: _id, ...e }) => e) })}\n\n` +
      `Compare red lines with the original and return the full corrected scene: move/resize elements whose red outline does not sit on the original, add anything missing, delete anything that does not exist, keep correct elements unchanged.`
    : `Image size: ${opts.width} x ${opts.height} px. Build the complete scene for this drawing.`;

  opts.onProgress?.(refine ? 'AI가 현재 장면을 원본과 비교하는 중…' : 'AI가 원본을 읽고 초안을 만드는 중…');
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    thinking: { type: 'adaptive' },
    output_config: { effort: refine ? 'high' : 'xhigh', format: betaZodOutputFormat(SceneSchema) },
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Original image:' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(opts.original) } },
        { type: 'text', text: refine ? 'Original with isometric grid and the current scene in red:' : 'Original with isometric grid:' },
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(opts.gridded) } },
        { type: 'text', text },
      ],
    }],
  }, { signal: opts.signal });

  let chars = 0;
  stream.on('text', (t) => { chars += t.length; opts.onProgress?.(`장면 데이터를 받는 중… ${(chars / 1000).toFixed(1)}k자`); });
  const msg = await stream.finalMessage();

  if (msg.stop_reason === 'refusal') throw new Error('AI가 이 요청을 처리하지 않았어요(안전 정책). 다른 이미지로 시도해 주세요.');
  if (msg.stop_reason === 'max_tokens') throw new Error('장면이 너무 커서 응답이 잘렸어요. 이미지를 나눠서 시도해 주세요.');
  const parsed = msg.parsed_output;
  if (!parsed) throw new Error('AI 응답을 장면 데이터로 읽지 못했어요. 다시 시도해 주세요.');
  return parsed.elements;
}

// ---------------------------------------------------------------- claude.ai 아티팩트: 보는 사람의 Claude 구독으로 호출
/** 쓸 수 있는 AI 경로: 구독(아티팩트) / API 키 / 없음 */
export async function aiMode(): Promise<'subscription' | 'key' | null> {
  if (await getSample()) return 'subscription';
  return getKey() ? 'key' : null;
}
export const hostedInClaude = inClaude;

// 한 줄에 요소 하나(JSON 배열). 응답이 길이 한도에서 잘려도 완성된 줄은 살릴 수 있다.
const LINE_FORMAT = `OUTPUT FORMAT (strict): reply with one element per line, each line a JSON array, nothing else - no prose, no code fence:
[kind, a0, a1, b0, b1, z, h, n, m, dir, color, note, points]
kind one of ${KINDS.join('|')}; dir one of ${DIRS.join('|')}; color one of ${COLORS.join('|')}; note a short string; points [[a,b,z],...] for route/floor, else [].
Example line: ["table",1990,2460,240,330,0,72,0,0,"+b","white","meeting table",[]]`;

// data: URL → Blob. 아티팩트에서는 fetch()가 막혀 있어 직접 디코딩한다.
const blobOf = async (dataUrl: string) => {
  const comma = dataUrl.indexOf(',');
  const type = dataUrl.slice(5, dataUrl.indexOf(';'));
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

function parseLines(text: string): El[] {
  const out: El[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/,$/, '');
    if (!line.startsWith('[')) continue;
    try {
      const v = JSON.parse(line);
      if (!Array.isArray(v) || v.length < 12) continue;
      const [kind, a0, a1, b0, b1, z, h, n, m, dir, color, note, points] = v;
      const el = SceneSchema.shape.elements.element.safeParse({
        kind, a0: +a0, a1: +a1, b0: +b0, b1: +b1, z: +z, h: +h, n: +n, m: +m,
        dir: DIRS.includes(dir) ? dir : '+b', color: COLORS.includes(color) ? color : 'white', note: String(note ?? ''),
        points: Array.isArray(points) ? points.filter((p: unknown) => Array.isArray(p) && p.length >= 2).map((p: number[]) => ({ a: +p[0], b: +p[1], z: +(p[2] ?? 0) })) : [],
      });
      if (el.success) out.push(el.data);
    } catch { /* 잘린 마지막 줄 등은 건너뜀 */ }
  }
  return out;
}

const lineOf = (e: El) => JSON.stringify([e.kind, e.a0, e.a1, e.b0, e.b1, e.z, e.h, e.n, e.m, e.dir, e.color, e.note, e.points.map((q) => [q.a, q.b, q.z])]);
const countLines = (t: string) => t.split('\n').filter((l) => l.trim().startsWith('[')).length;

/** 요소의 화면상 중심(구역 배정용) */
function centerOf(e: El): [number, number] {
  if (e.points.length) {
    const n = e.points.length;
    const a = e.points.reduce((t, q) => t + q.a, 0) / n, b = e.points.reduce((t, q) => t + q.b, 0) / n, z = e.points.reduce((t, q) => t + q.z, 0) / n;
    return [C * (a + b), S * (a - b) - z];
  }
  const a = (e.a0 + e.a1) / 2, b = (e.b0 + e.b1) / 2, z = e.z + (e.kind === 'slab' ? 0 : e.h / 2);
  return [C * (a + b), S * (a - b) - z];
}
const inside = ([x, y]: [number, number], r: Rect, W: number, H: number) => {
  const cx = Math.min(W - 1, Math.max(0, x)), cy = Math.min(H - 1, Math.max(0, y));   // 화면 밖 요소는 가장 가까운 구역으로
  return cx >= r.x && cx < r.x + r.w && cy >= r.y && cy < r.y + r.h;
};

type SampleErr = { code?: string; message?: string; text?: string };
const sampleError = (code: string, secs: number) =>
  new Error(`${SAMPLE_ERR[code] ?? 'Claude 호출이 실패했어요.'} (오류 코드: ${code}, ${secs}초 만에 중단)`);

/** 한 번의 요청. 응답이 잘리거나 연결이 끊기면 받은 것은 두고 나머지를 이어 받는다(최대 3번). */
async function askWithContinuation(sample: NonNullable<Awaited<ReturnType<typeof getSample>>>, base: string, images: Blob[], effort: string, opts: Parameters<typeof runAI>[0], label: string): Promise<El[]> {
  const got: El[] = [];
  const t0 = performance.now();
  for (let part = 0; part < 3; part++) {
    const prompt = part === 0 ? base
      : `${base}\n\nYOU ALREADY OUTPUT THESE ${got.length} ELEMENTS - do not repeat them:\n${got.map(lineOf).join('\n')}\n\nContinue with ONLY the remaining elements, same format, same back-to-front order. If nothing remains, output nothing.`;
    opts.onProgress?.(part === 0 ? `${label} · Claude가 그림을 분석하는 중` : `${label} · 응답이 잘려서 나머지를 이어 받는 중`);
    try {
      const { text, truncated } = await sample(prompt, {
        images, modelTier: 'complex', effort, cache: false, signal: opts.signal,
        onText: ({ text }: { text: string }) => opts.onProgress?.(`${label} · 받는 중 · 요소 ${got.length + countLines(text)}개`),
      });
      got.push(...parseLines(text));
      if (!truncated) return got;
    } catch (e) {
      const err = e as SampleErr;
      if (!err.code) throw e;
      if (err.code === 'cancelled') throw new DOMException('중단', 'AbortError');
      const partial = err.text ? parseLines(err.text) : [];
      if (err.code === 'upstream_error' && partial.length) { got.push(...partial); continue; }
      if (got.length + partial.length > 10) return [...got, ...partial];
      throw sampleError(err.code, Math.round((performance.now() - t0) / 1000));
    }
  }
  return got;
}

async function runSample(opts: Parameters<typeof runAI>[0]): Promise<El[]> {
  const sample = (await getSample())!;
  if (!opts.base) throw new Error('원본 이미지가 없어요.');
  const lim = await sample.limits().catch(() => null);
  if (!lim?.images) throw new Error('이 화면에서는 이미지를 Claude에게 보낼 수 없어요. claude.ai에서 페이지를 새로고침해 주세요. (오류 코드: images_unavailable)');
  const twoImages = lim.images.maxCount >= 2;
  const refine = !!opts.current?.length;
  const W = opts.width, H = opts.height;
  // 구역 수: 긴 변 약 550px마다 1구역 → 호출 1번이 짧아지고 구역마다 해상도가 높아진다
  const n = Math.max(1, Math.min(5, Math.round(Math.max(W, H) / 550)));
  const regions = splitRegions(W, H, n);
  const out: El[] = [];
  // 화면 아래(앞·아래층) 구역부터: 합칠 때 아래층이 먼저 그려진다
  for (let idx = n - 1; idx >= 0; idx--) {
    const { core, crop } = regions[idx];
    const label = n > 1 ? `구역 ${n - idx}/${n}` : '전체';
    const mine = refine ? opts.current!.filter((e) => inside(centerOf(e), core, W, H)) : [];
    const gridded = await renderRegion(opts.base, { crop, grid: true, overlaySvg: refine ? opts.overlaySvg : null });
    const images = [await blobOf(gridded)];
    if (twoImages) images.unshift(await blobOf(await renderRegion(opts.base, { crop })));
    const where = `This request covers one horizontal band of a larger drawing: screen pixels x ${Math.round(crop.x)}..${Math.round(crop.x + crop.w)}, y ${Math.round(crop.y)}..${Math.round(crop.y + crop.h)} of the full ${W} x ${H} image. The grid labels are GLOBAL chart coordinates of the full image - use them exactly as printed. Output every element whose main part is visible in this band (other bands are handled separately).`;
    const imgs = twoImages ? 'Image 1 is the band of the original; image 2 is the same band with the isometric grid' : 'The image is the band of the original with the isometric grid drawn over it';
    const task = refine
      ? `${where}\n${imgs}, and the CURRENT scene drawn in red.\nCurrent elements in this band, one per line:\n${mine.map(lineOf).join('\n') || '(none)'}\n\nCompare the red lines with the original and output the corrected list for this band: move/resize elements whose red outline does not sit on the original, add anything missing - especially small objects (each chair, plant, monitor, laptop, box, door frame) the original shows but the red drawing lacks - shrink anything drawn bigger than the original, drop anything that does not exist, keep correct elements unchanged.`
      : `${where}\n${imgs}. Build the scene elements for this band.`;
    const base = `${SYSTEM}\n\n${LINE_FORMAT}\n\n${task}`;
    const els = await askWithContinuation(sample, base, images, refine ? 'medium' : 'high', opts, label);
    const keep = els.filter((e) => inside(centerOf(e), core, W, H));
    // 보정 결과가 많이 모자라면 이 구역은 이전 것을 유지
    out.push(...(refine && keep.length < mine.length * 0.6 ? mine : keep));
  }
  if (!out.length) throw new Error('AI 응답에서 도면 요소를 읽지 못했어요. 다시 시도해 주세요.');
  return out;
}

const SAMPLE_ERR: Record<string, string> = {
  not_granted: '이 페이지가 Claude를 쓰도록 허용되지 않았어요. 아티팩트 오른쪽 위 메뉴의 권한에서 허용해 주세요.',
  sampling_disabled: '이 계정에서는 아티팩트의 Claude 호출을 쓸 수 없어요.',
  rate_limited: 'Claude 사용 한도에 걸렸어요. 잠시 뒤에 다시 시도해 주세요.',
  session_expired: 'claude.ai 로그인이 만료됐어요. 다시 로그인해 주세요.',
  images_unavailable: '이 화면에서는 이미지를 Claude에게 보낼 수 없어요.',
  image_rejected: '이미지를 보낼 수 없어요. 다른 파일로 시도해 주세요.',
  refused: 'Claude가 이 요청을 처리하지 않았어요.',
  prompt_too_large: '장면이 너무 커서 보낼 수 없어요.',
  empty_completion: 'Claude가 아무것도 돌려주지 않았어요. 다시 시도해 주세요.',
  upstream_error: '연결이 끊겼어요. 다시 시도해 주세요.',
};

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않아요. ⚙에서 키를 확인해 주세요.';
  if (err instanceof Anthropic.PermissionDeniedError) return '이 키로는 해당 모델을 쓸 권한이 없어요.';
  if (err instanceof Anthropic.RateLimitError) return '요청이 많아 잠시 막혔어요. 1분쯤 뒤에 다시 시도해 주세요.';
  if (err instanceof Anthropic.APIUserAbortError) return '취소했어요.';
  if (err instanceof Anthropic.APIConnectionError) return '네트워크 연결에 실패했어요.';
  if (err instanceof Anthropic.APIError) return `API 오류 (${err.status ?? '?'}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
