// 헤더 아래 로딩바. p = 0..1 진행률, null = 숨김.
// until을 주면 그 지점을 향해 천천히 차오른다(오래 걸리는 AI 단계에서도 멈춰 보이지 않게).
let cur = 0, target = 0, timer: number | undefined;

function paint() {
  document.querySelectorAll<HTMLElement>('.loadbar').forEach((bar) => {
    bar.hidden = false;
    bar.style.setProperty('--p', String(Math.max(0.04, Math.min(1, cur))));
  });
}

export function setBusy(p: number | null, until?: number) {
  clearInterval(timer);
  if (p === null) {
    document.querySelectorAll<HTMLElement>('.loadbar').forEach((bar) => (bar.hidden = true));
    document.body.removeAttribute('aria-busy');
    return;
  }
  document.body.setAttribute('aria-busy', 'true');
  cur = p; target = until ?? p;
  paint();
  if (target > cur) timer = window.setInterval(() => { cur += (target - cur) * 0.04; paint(); }, 1000);
}
