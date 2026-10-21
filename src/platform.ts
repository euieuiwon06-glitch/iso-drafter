// 실행 환경 차이를 감춘다: claude.ai 아티팩트(구독으로 Claude 호출, 다운로드 기능) vs 일반 웹페이지.

type ClaudeGlobal = { use(name: string): Promise<unknown> };
declare global { interface Window { claude?: ClaudeGlobal } }

/** claude.ai 아티팩트 뷰어 안에서 열렸는지 */
export const inClaude = () => typeof window.claude?.use === 'function';

export type SampleFn = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string; truncated: boolean }>) & {
  limits(): Promise<{ maxPromptBytes: number; images?: { maxCount: number } }>;
};
type Downloads = { save(req: { filename: string; data: string | Blob }): Promise<unknown> };

let sampleP: Promise<SampleFn | null> | null = null;
let dlP: Promise<Downloads | null> | null = null;
const use = <T>(name: string): Promise<T | null> =>
  inClaude() ? window.claude!.use(name).then((v) => (v as T) ?? null).catch(() => null) : Promise.resolve(null);

/** 구독으로 Claude를 부르는 함수(아티팩트에서만). 없으면 null */
export const getSample = () => (sampleP ??= use<SampleFn>('sample'));
const getDownloads = () => (dlP ??= use<Downloads>('downloads'));

/** 파일 저장: 아티팩트에서는 다운로드 기능, 일반 페이지에서는 링크 */
export async function saveFile(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const dl = await getDownloads();
  if (dl) {
    try { await dl.save({ filename, data: blob }); } catch { /* 보는 사람이 취소 */ }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 페이지 안 확인창 (아티팩트에서는 confirm()이 막혀 있다) */
export function askConfirm(message: string, ok = '계속', cancel = '취소'): Promise<boolean> {
  return new Promise((resolve) => {
    const d = document.getElementById('dlgConfirm') as HTMLDialogElement;
    d.querySelector('p')!.textContent = message;
    (d.querySelector('[value=ok]') as HTMLButtonElement).textContent = ok;
    (d.querySelector('[value=cancel]') as HTMLButtonElement).textContent = cancel;
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });
}
