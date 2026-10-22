// Claude로 원본 이미지를 읽어 장면 데이터(초안)를 만들거나, 현재 장면을 원본에 맞게 보정한다.
// API 키는 사용자의 브라우저(localStorage)에만 저장되고 Anthropic API로 직접 전송된다.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { SceneSchema, KINDS, DIRS, COLORS, type El } from './schema';
import { getSample, inClaude } from './platform';
import { renderRegion, splitRegions, type Rect } from './grid';
import { P, getProjection, liftShift } from './iso';
import { edgeField, fitDraft, acceptEdit, acceptAdd, acceptDel, snap, groundScene, type Field } from './fit';

const MODEL = 'claude-opus-5-5';

const SYSTEM_T = `You convert an image of an isometric architectural / interior drawing into a scene description for an isometric line-drawing renderer. The renderer redraws the scene as a clean technical illustration: exact isometric axes, uniform ink lines, flat fills, green circulation route.

COORDINATES
- The second image is the original with an isometric grid. Red lines are constant-A lines, blue lines are constant-B lines, every 50 units; purple labels "A,B" mark grid crossings every 100 units. Read every position off this grid.
{{PROJ}}
- Chart-frame convention (important, keeps multi-level buildings simple): give every floor the A,B coordinates its top surface visibly occupies on the grid and z = 0. Everything standing on that floor (walls, furniture, routes, nodes) also uses z = 0 and the coordinates read at its foot on that floor. Do not try to model true storey heights. Use z > 0 only for an item raised relative to the floor it visually stands on (e.g. a monitor on a desk: z = desk height).

ELEMENTS (fill every field; unused numbers = 0, unused points = [], note = short description)
- slab: floor plate, top face rectangle a0..a1 x b0..b1, thickness h (12-30). color white or green.
- floor: flat colored area drawn on a floor, polygon "points" (z = 0). Use for green carpets/rooms (color green) and corridor strips (color greenStrip).
- wall: opaque box a0..a1 x b0..b1 (thickness ~10-16), height h. color white (or green for a green feature wall).
- glass: vertical glass panel from (a0,b0) to (a1,b1) - axis-aligned, one of A or B constant - height h, n = number of mullions. color white (clear), green (green-tinted), gray (opaque white panel).
- rail: low glass balustrade like glass, h 90-120, n posts.
- door: empty door frame from (a0,b0) to (a1,b1), height h.
- table: desk/table footprint a0..a1 x b0..b1, height h (72-110).
- chair, taskChair (office chair, dark seat): footprint a0..a1 x b0..b1 = the seat as measured on the grid (usually 18-35 units); dir = direction the sitter faces (+a,-a,+b,-b).
- stool: bar stool, footprint = seat as measured, height h (55-75).
- sofa: footprint a0..a1 x b0..b1; dir +b/-b = back along the B1 edge, +a/-a = back along the A0 edge.
- roundTable: footprint a0..a1 x b0..b1 (diameter), height h.
- shelf: bookcase box a0..a1 x b0..b1, height h, n rows, m columns; dir -b = open face on the B0 side, +a = open face on the A1 side (only these two faces are visible; use them).
- monitor: footprint = the screen width as measured (a0..a1 or b0..b1 along the screen), z = desk height; dir +a/-a = screen spans along A, +b/-b = along B.
- laptop: footprint as measured, z = table height.
- plant: potted plant, footprint = foliage width as measured, h = total height. Output EVERY plant separately (planter rows: one plant element per visible plant).
- armchair: lounge armchair, footprint as measured; dir like sofa.
- planter: long planter box with plants on top, footprint and box height h as measured, n = number of plants visible.
- counter: kitchen counter / island / reception desk, footprint and height as measured, n = number of sinks.
- panel: thin board on a wall - whiteboard, TV, screen, artwork, door leaf - from (a0,b0) to (a1,b1) along the wall, z = bottom height, h = panel height, n = 1 for an inner frame.
- prism: any object with a non-rectangular footprint (L-shaped desk, curved bench, rounded sofa, odd cabinet): points = footprint polygon corners at its base z, h = height.
- prism with n = 1: SMOOTH curved outline - points become control points of a closed smooth curve (rounded sofa, kidney/oval/organic table, curved counter or bench, rounded cabinet ends, pebble ottoman).
- curve: smooth 3D curve through points (ink line) for curved details - bent chair backs and armrests, faucet spouts, lamp arms, plant stems, cables, handles, curved rails. Use many.
- lathe: round turned object - vase, flower pot, lamp, bottle, cup, bowl, round stool, pedestal, toilet bowl, washbasin. a0,b0 = centre on the floor plan, z = base height, points = profile from bottom to top as [radius, 0, height above base].
- floor with m = 1: smooth curved outline (round or organic rugs).
- lines: extra ink detail drawn on surfaces - cabinet door and drawer seams, panel divisions, handles, mullions, desk privacy screens, keyboard outlines. points = 3D polyline. Use liberally to reach the original's level of detail.
- cabinet: wardrobe, closet, nightstand, dresser, TV unit, sideboard, kitchen base or wall cabinet, fridge, washing machine. Footprint and height as measured; dir = side with the doors (-b or +a when visible); n = number of doors, m = number of drawer rows.
- bed: footprint of the whole bed; dir = headboard side; h = headboard height.
- toilet: footprint as measured; dir = tank (wall) side.
- bathtub: footprint and rim height as measured; dir = faucet end.
- window: window in a wall, from (a0,b0) to (a1,b1) along the wall, z = sill height, h = window height, n = number of vertical panes.
- counter: also use m = number of cooktop burners when it has a stove.
- box: any small box-like object - crate, carton on a shelf, cabinet, counter, appliance, printer, locker, planter box, robot body. Footprint and height as measured; color white unless clearly green.
- stairs: footprint a0..a1 x b0..b1, total drop h (the floor it descends from is h above the base), n steps, dir = descending direction. Base coordinates are those of the lower floor.

IGNORE ANNOTATION GRAPHICS: draw only the physical space. Diagram overlays are NOT part of the space - circulation/route lines, dashed or dotted paths, location markers, pins, target/ring nodes, translucent highlight columns or shafts, arrows, callouts, labels and text. Do not output anything for them, and draw the floor, walls and furniture behind them as if they were not there. Never use kinds route, node or shaft.

DRAW ORDER: the renderer paints elements in array order (painter's algorithm). Output back-to-front: lower/farther floors before nearer ones; within a floor: slab, floor colors, back walls, furniture from far (small A, large B) to near, front glass/rails last.

QUALITY - DENSITY AND TRUE SIZE (most important):
- Match the original's level of detail. Every individual object the image shows becomes its own element: each chair, each monitor, each laptop, each plant, each box on a shelf rack, each cabinet, each door frame, each glass panel run, each rail. Never summarise a group ("a row of desks") as one bigger element, and never skip small objects. A detailed office drawing usually needs 150-400 elements; a band of it 60-200.
- True size: measure every footprint by reading the grid at the object's actual corners. Do not enlarge objects, do not round sizes up, do not make furniture chunkier than drawn. Small things stay small (chairs ~20-35, monitors ~25-45 wide in typical drawings - but always trust your measurement over these hints). Snap to multiples of 5 only when that changes a size by less than 10%.
- Respect the room structure: every object sits inside the room it is in, on that room's floor; furniture never crosses or overlaps a wall; walls meet at real corners and follow the original wall lines exactly. Do not invent walls, partitions or objects that are not drawn.
- Keep spacing: rows of chairs/desks keep the original count and pitch.
- Curves: wherever the original is curved (round tables, rugs, pots, vases, lamps, armchairs, rounded furniture, sanitary ware), use lathe / prism n=1 / curve / round floor - never approximate a curved object with boxes.
- Use the most specific kind for each object (bed, cabinet, toilet, bathtub, window, sofa, armchair, roundTable for round or oval tables, planter, counter, panel...). Build composite objects from several elements (a desk = table + monitors + task chairs + lines for the privacy screen; a kitchen = counter + box cabinets + lines for doors). Reach for box only when nothing more specific fits.
- Straighten anything the source drew slightly off-axis.`;

/** 현재 투영에 맞춘 좌표 설명을 넣은 지시문 */
function systemPrompt() {
  const pr = getProjection(), [la, lb] = liftShift(1);
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const ca = Math.cos((pr.a * Math.PI) / 180), sa = Math.sin((pr.a * Math.PI) / 180), cb = Math.cos((pr.b * Math.PI) / 180), sb = Math.sin((pr.b * Math.PI) / 180);
  const proj = `- Screen mapping: X = ${r(ca)}*A + ${r(cb)}*B, Y = ${r(sa)}*A + ${r(sb)}*B - z. +A runs down-right on screen (${Math.round(pr.a)} deg below horizontal), +B runs up-right (${Math.round(-pr.b)} deg above horizontal), z is up. The viewer looks from the +A / -B side, so the visible vertical faces of a box are its B0 face (lower-left) and its A1 face (lower-right).
- A point h units above grid point (A,B) appears on the grid at (A ${la >= 0 ? '+' : '-'} ${r(Math.abs(la))}*h, B ${lb >= 0 ? '+' : '-'} ${r(Math.abs(lb))}*h). Use this to find the ground position of tall things from their tops.`;
  return SYSTEM_T.replace('{{PROJ}}', proj);
}

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
    system: systemPrompt(),
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
kind one of ${KINDS.join('|')}; dir one of ${DIRS.join('|')}; color one of ${COLORS.join('|')}; note a short string; points [[a,b,z],...] for floor/prism/lines/curve/lathe, else [].
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
    return P(a, b, z);
  }
  const a = (e.a0 + e.a1) / 2, b = (e.b0 + e.b1) / 2, z = e.z + (e.kind === 'slab' ? 0 : e.h / 2);
  return P(a, b, z);
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

// 보정은 수정분만 받는다: 언급하지 않은 요소는 그대로 남아 디테일이 줄지 않는다.
const DELTA_FORMAT = `OUTPUT FORMAT (strict): reply with one change per line, each a JSON array, nothing else - no prose, no code fence:
["edit", i, ELEMENT]   replace current element number i (move it / fix its size / fix its kind)
["del", i]             remove current element number i (only if it does not exist in the original)
["add", ELEMENT]       a missing element
ELEMENT is [kind, a0, a1, b0, b1, z, h, n, m, dir, color, note, points] as in the element list. Elements you do not mention stay exactly as they are - so do not repeat correct elements. If nothing needs changing, output nothing.`;

const footprintSize = (e: El) => Math.max(Math.abs(e.a1 - e.a0), 1) * Math.max(Math.abs(e.b1 - e.b0), 1);

/** 수정분을 현재 요소들에 적용한다. 원래보다 크게 키운 수정은 크기를 무시하고 위치만 옮긴다. */
function applyDelta(mine: El[], text: string, f: Field): { kept: El[]; added: El[]; edits: number; dels: number; blocked: number; rejected: number } {
  const els: (El | null)[] = mine.map((e) => ({ ...e }));
  const added: El[] = [];
  let edits = 0, dels = 0, blocked = 0, rejected = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/,$/, '');
    if (!line.startsWith('[')) continue;
    let v: unknown;
    try { v = JSON.parse(line); } catch { continue; }
    if (!Array.isArray(v)) continue;
    const [op, x, y] = v as [string, unknown, unknown];
    if (op === 'del' && typeof x === 'number' && els[x]) {
      if (acceptDel(els[x]!, f)) { els[x] = null; dels++; } else rejected++;
      continue;
    }
    const el = parseLines(JSON.stringify(op === 'edit' ? y : x))[0];
    if (!el) continue;
    if (op === 'add') { if (acceptAdd(el, f)) added.push(el); else rejected++; continue; }
    if (op === 'edit' && typeof x === 'number' && els[x]) {
      const old = els[x]!;
      const grow = footprintSize(el) / footprintSize(old);
      const growH = old.h > 0 ? el.h / old.h : 1;
      if (grow > 1.56 || growH > 1.3) {
        // 키우는 수정: 원래 크기를 유지한 채 새 중심으로만 옮긴다
        const da = (el.a0 + el.a1) / 2 - (old.a0 + old.a1) / 2, db = (el.b0 + el.b1) / 2 - (old.b0 + old.b1) / 2;
        const moved = { ...old, a0: old.a0 + da, a1: old.a1 + da, b0: old.b0 + db, b1: old.b1 + db };
        if (acceptEdit(old, moved, f)) els[x] = moved;
        blocked++;
      } else if (acceptEdit(old, el, f)) { els[x] = el; edits++; } else rejected++;
    }
  }
  // 남은 요소도 원본 선에 붙인다
  const kept = els.filter((e): e is El => !!e).map((e) => snap(e, f).el);
  return { kept, added: added.map((e) => snap(e, f).el), edits, dels, blocked, rejected };
}

const ANNOTATION = new Set(['route', 'node', 'shaft']);

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
  const img = opts.base;
  const field = edgeField(img);
  // 구역들을 동시에(최대 3개) 보낸다. 결과는 화면 아래(앞·아래층) 구역부터 이어 붙여 아래층이 먼저 그려지게 한다.
  const band = async (idx: number): Promise<El[]> => {
    const out: El[] = [];
    const { core, crop } = regions[idx];
    const label = n > 1 ? `구역 ${n - idx}/${n}` : '전체';
    const mine = refine ? opts.current!.filter((e) => !ANNOTATION.has(e.kind) && inside(centerOf(e), core, W, H)) : [];
    const gridded = await renderRegion(img, { crop, grid: true, overlaySvg: refine ? opts.overlaySvg : null });
    const images = [await blobOf(gridded)];
    if (twoImages) images.unshift(await blobOf(await renderRegion(img, { crop })));
    const where = `This request covers one horizontal band of a larger drawing: screen pixels x ${Math.round(crop.x)}..${Math.round(crop.x + crop.w)}, y ${Math.round(crop.y)}..${Math.round(crop.y + crop.h)} of the full ${W} x ${H} image. The grid labels are GLOBAL chart coordinates of the full image - use them exactly as printed. Output every element whose main part is visible in this band (other bands are handled separately).`;
    const imgs = twoImages ? 'Image 1 is the band of the original; image 2 is the same band with the isometric grid' : 'The image is the band of the original with the isometric grid drawn over it';
    if (refine) {
      const numbered = mine.map((e, k) => `${k}: ${lineOf(e)}`).join('\n') || '(none)';
      const task = `${where}\n${imgs}, and the CURRENT scene drawn in red.\nCurrent elements in this band, numbered:\n${numbered}\n\nCompare the red drawing with the original and list only the needed changes:\n- move elements whose red outline does not sit on the original;\n- shrink elements drawn bigger than the original (never make anything bigger unless the original is clearly bigger);\n- add every object the original shows but the red drawing lacks - especially small ones (each chair, plant, monitor, laptop, box, door frame, shelf, cabinet);\n- delete only elements that do not exist in the original, or that are annotation graphics (routes, markers, highlight shafts).`;
      const prompt = `${systemPrompt()}\n\n${DELTA_FORMAT}\n\n${task}`;
      opts.onProgress?.(`${label} · Claude가 차이를 비교하는 중`);
      try {
        const { text } = await sample(prompt, {
          images, modelTier: 'complex', effort: 'medium', cache: false, signal: opts.signal,
          onText: ({ text }: { text: string }) => opts.onProgress?.(`${label} · 수정 사항 받는 중 · ${countLines(text)}건`),
        });
        const d = applyDelta(mine, text, field);
        const added = d.added.filter((e) => !ANNOTATION.has(e.kind) && inside(centerOf(e), core, W, H));
        out.push(...d.kept, ...added);
        opts.onProgress?.(`${label} · 수정 ${d.edits} · 추가 ${added.length} · 삭제 ${d.dels}${d.blocked ? ` · 키우기 막음 ${d.blocked}` : ''}${d.rejected ? ` · 원본과 안 맞아 거절 ${d.rejected}` : ''}`);
      } catch (e) {
        const err = e as SampleErr;
        if (err.code === 'cancelled') throw new DOMException('중단', 'AbortError');
        if (!err.code) throw e;
        out.push(...mine);   // 이 구역 보정이 실패하면 그대로 둔다(전체 작업은 계속)
        opts.onProgress?.(`${label} · 보정을 건너뜀 (오류 코드: ${err.code})`);
      }
      return out;
    }
    const task = `${where}\n${imgs}. Build the scene elements for this band.`;
    const base = `${systemPrompt()}\n\n${LINE_FORMAT}\n\n${task}`;
    const els = (await askWithContinuation(sample, base, images, 'high', opts, label)).filter((e) => !ANNOTATION.has(e.kind));
    const fit = fitDraft(els.filter((e) => inside(centerOf(e), core, W, H)), field);
    out.push(...fit.els);
    opts.onProgress?.(`${label} · 원본 선에 맞춤 ${fit.moved} · 근거 없어 제외 ${fit.dropped}`);
    return out;
  };
  const results: El[][] = new Array(n);
  const order = Array.from({ length: n }, (_, i) => n - 1 - i);
  let next = 0;
  const worker = async () => { while (next < order.length) { const idx = order[next++]; results[idx] = await band(idx); } };
  await Promise.all(Array.from({ length: Math.min(3, n) }, worker));
  const merged = order.flatMap((idx) => results[idx] ?? []);
  if (!merged.length) throw new Error('AI 응답에서 도면 요소를 읽지 못했어요. 다시 시도해 주세요.');
  // 공간 규칙: 건물 밖 물건 제외, 뜬 물건은 받침 위나 바닥으로, 벽과 겹치면 밀어내기, 비정상 크기 줄이기
  const g = groundScene(merged, field);
  opts.onProgress?.(`공간 정리 · 받침에 올림 ${g.lifted} · 바닥으로 내림 ${g.dropped2floor} · 벽에서 밀어냄 ${g.pushed} · 건물 밖 제외 ${g.removed} · 크기 조정 ${g.resized}`);
  return g.els;
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
