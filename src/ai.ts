// Claude로 원본 이미지를 읽어 장면 데이터(초안)를 만들거나, 현재 장면을 원본에 맞게 보정한다.
// API 키는 사용자의 브라우저(localStorage)에만 저장되고 Anthropic API로 직접 전송된다.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { SceneSchema, type El } from './schema';

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
- chair, taskChair (office chair, dark seat): centre (a0,b0); dir = direction the sitter faces (+a,-a,+b,-b).
- stool: bar stool centre (a0,b0), height h (55-75).
- sofa: footprint a0..a1 x b0..b1; dir +b/-b = back along the B1 edge, +a/-a = back along the A0 edge.
- roundTable: footprint a0..a1 x b0..b1 (diameter), height h.
- shelf: bookcase box a0..a1 x b0..b1, height h, n rows, m columns; dir -b = open face on the B0 side, +a = open face on the A1 side (only these two faces are visible; use them).
- monitor: centre (a0,b0) at z = desk height; dir +a/-a = screen spans along A, +b/-b = along B.
- laptop: centre (a0,b0) at z = table height.
- stairs: footprint a0..a1 x b0..b1, total drop h (the floor it descends from is h above the base), n steps, dir = descending direction. Base coordinates are those of the lower floor.
- route: green circulation line, "points" polyline (axis-aligned segments wherever the image shows corners; follow stairs with straight diagonal segments).
- node: route marker circle, centre (a0,b0).

DRAW ORDER: the renderer paints elements in array order (painter's algorithm). Output back-to-front: lower/farther floors before nearer ones; within a floor: slab, floor colors, back walls, furniture from far (small A, large B) to near, front glass/rails, then shafts, then routes, then nodes last.

QUALITY: capture every room, wall, glass partition, rail and furniture group visible in the image, with dimensions snapped to multiples of 5. Straighten anything the source drew slightly off-axis. Prefer many correct simple elements over few vague ones.`;

export function getKey() { try { return localStorage.getItem('iso-drafter:key') ?? ''; } catch { return ''; } }
export function setKey(k: string) { try { localStorage.setItem('iso-drafter:key', k); } catch { /* 저장 불가 환경 */ } }

const b64 = (dataUrl: string) => dataUrl.slice(dataUrl.indexOf(',') + 1);

export type Progress = (msg: string) => void;

export async function runAI(opts: {
  original: string; gridded: string; width: number; height: number;
  current?: El[]; onProgress?: Progress; signal?: AbortSignal;
}): Promise<El[]> {
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
    output_config: { effort: 'high', format: betaZodOutputFormat(SceneSchema) },
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

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않아요. ⚙에서 키를 확인해 주세요.';
  if (err instanceof Anthropic.PermissionDeniedError) return '이 키로는 해당 모델을 쓸 권한이 없어요.';
  if (err instanceof Anthropic.RateLimitError) return '요청이 많아 잠시 막혔어요. 1분쯤 뒤에 다시 시도해 주세요.';
  if (err instanceof Anthropic.APIUserAbortError) return '취소했어요.';
  if (err instanceof Anthropic.APIConnectionError) return '네트워크 연결에 실패했어요.';
  if (err instanceof Anthropic.APIError) return `API 오류 (${err.status ?? '?'}): ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
