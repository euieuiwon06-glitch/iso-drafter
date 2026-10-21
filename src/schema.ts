// 장면 데이터 형식. AI 출력(structured output)과 에디터가 같은 스키마를 쓴다.
// 좌표는 '차트 좌표' (A, B): z=0 평면에 놓였을 때의 위치. 화면 X = C·(A+B), Y = S·(A−B) − z.
// A축 = 화면에서 오른쪽 아래(30°), B축 = 오른쪽 위(30°), z = 위.
import { z } from 'zod';

export const KINDS = [
  'slab', 'floor', 'wall', 'glass', 'rail', 'door', 'shaft',
  'table', 'chair', 'taskChair', 'stool', 'sofa', 'armchair', 'roundTable', 'shelf', 'monitor', 'laptop', 'plant', 'planter', 'box', 'counter', 'panel', 'prism', 'lines', 'curve', 'lathe',
  'stairs', 'route', 'node',
] as const;
export type Kind = (typeof KINDS)[number];

export const COLORS = ['white', 'green', 'greenStrip', 'greenGlass', 'gray'] as const;
export type ColorName = (typeof COLORS)[number];

export const DIRS = ['+a', '-a', '+b', '-b'] as const;
export type Dir = (typeof DIRS)[number];

const Pt = z.object({ a: z.number(), b: z.number(), z: z.number() });

export const ElementSchema = z.object({
  kind: z.enum(KINDS),
  a0: z.number(), a1: z.number(), b0: z.number(), b1: z.number(),
  z: z.number(), h: z.number(),
  n: z.number(), m: z.number(),
  dir: z.enum(DIRS),
  color: z.enum(COLORS),
  points: z.array(Pt),
  note: z.string(),
});
export type El = z.infer<typeof ElementSchema> & { id?: string };

export const SceneSchema = z.object({
  elements: z.array(ElementSchema),
});
export type Scene = { width: number; height: number; elements: El[] };

export const KIND_LABEL: Record<Kind, string> = {
  slab: '바닥판', floor: '바닥 면(색)', wall: '벽(불투명)', glass: '유리벽', rail: '난간', door: '문틀', shaft: '샤프트',
  table: '책상', chair: '의자', taskChair: '사무 의자', stool: '스툴', sofa: '소파', roundTable: '원형 테이블',
  shelf: '책장', monitor: '모니터', laptop: '노트북', plant: '화분', box: '상자', armchair: '안락의자', planter: '긴 화분', counter: '조리대', panel: '판(보드·TV)', prism: '다각·곡선 입체', lines: '세부 선', curve: '3D 곡선', lathe: '회전체(화병·조명)', stairs: '계단', route: '동선', node: '노드',
};

// 요소별 기본값: 에디터에서 새로 추가할 때 (a,b)는 화면 중앙으로 옮겨진다.
export function defaults(kind: Kind): El {
  const base: El = { kind, a0: 0, a1: 100, b0: 0, b1: 100, z: 0, h: 0, n: 0, m: 0, dir: '+b', color: 'white', points: [], note: '' };
  switch (kind) {
    case 'slab': return { ...base, a1: 400, b1: 300, h: 18 };
    case 'floor': return { ...base, color: 'green', points: [{ a: 0, b: 0, z: 0 }, { a: 300, b: 0, z: 0 }, { a: 300, b: 200, z: 0 }, { a: 0, b: 200, z: 0 }] };
    case 'wall': return { ...base, a1: 300, b1: 12, h: 300 };
    case 'glass': return { ...base, a1: 300, b1: 0, h: 300, n: 2 };
    case 'rail': return { ...base, a1: 300, b1: 0, h: 95, n: 3 };
    case 'door': return { ...base, a1: 70, b1: 0, h: 160 };
    case 'shaft': return { ...base, a1: 58, b1: 58, h: 600 };
    case 'table': return { ...base, a1: 240, b1: 80, h: 74 };
    case 'chair': case 'taskChair': case 'stool': case 'node': case 'laptop':
      return { ...base, a1: 0, b1: 0, h: kind === 'stool' ? 62 : 0 };
    case 'plant': return { ...base, a1: 30, b1: 30, h: 70 };
    case 'box': return { ...base, a1: 40, b1: 40, h: 30 };
    case 'armchair': return { ...base, a1: 60, b1: 60, dir: '+b' };
    case 'planter': return { ...base, a1: 200, b1: 40, h: 40 };
    case 'counter': return { ...base, a1: 180, b1: 70, h: 90, n: 1 };
    case 'panel': return { ...base, a1: 120, b1: 0, z: 60, h: 80, n: 1 };
    case 'prism': return { ...base, points: [{ a: 0, b: 0, z: 0 }, { a: 80, b: 0, z: 0 }, { a: 80, b: 50, z: 0 }, { a: 0, b: 50, z: 0 }], h: 40 };
    case 'lines': return { ...base, points: [{ a: 0, b: 0, z: 40 }, { a: 80, b: 0, z: 40 }] };
    case 'curve': return { ...base, points: [{ a: 0, b: 0, z: 40 }, { a: 30, b: 10, z: 70 }, { a: 70, b: 0, z: 60 }] };
    case 'lathe': return { ...base, a1: 0, b1: 0, points: [{ a: 10, b: 0, z: 0 }, { a: 16, b: 0, z: 18 }, { a: 8, b: 0, z: 40 }, { a: 6, b: 0, z: 50 }] };
    case 'monitor': return { ...base, a1: 0, b1: 0, z: 74, dir: '+a' };
    case 'sofa': return { ...base, a1: 80, b1: 140, dir: '+b' };
    case 'roundTable': return { ...base, a1: 84, b1: 84, h: 72 };
    case 'shelf': return { ...base, a1: 200, b1: 40, h: 200, n: 5, m: 4, dir: '-b' };
    case 'stairs': return { ...base, a1: 360, b1: 110, h: 120, n: 11, dir: '+a' };
    case 'route': return { ...base, points: [{ a: 0, b: 0, z: 0 }, { a: 300, b: 0, z: 0 }, { a: 300, b: -200, z: 0 }] };
  }
}

/** 점 목록으로 모양을 정하는 종류 */
export const POINT_KINDS = new Set<string>(['floor', 'route', 'prism', 'lines', 'curve']);

let seq = 0;
export const newId = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;
