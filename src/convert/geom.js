// 기하 유틸: 등각 축, 선분 병합·모서리 맞춤, 다각형 축 정렬, 폴리라인 단순화.
export const AXES = { v: 90, r: 150, l: 30 };   // 수직, 오른쪽 위로, 오른쪽 아래로 (화면 각도, y 아래 방향)

export const unit = (deg) => { const t = (deg * Math.PI) / 180; return [Math.cos(t), Math.sin(t)]; };
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const len = (a) => Math.hypot(a[0], a[1]);
export const angDiff = (a, b) => Math.abs((((a - b) % 180) + 270) % 180 - 90);   // 0..90, 방향 무시
export const angleOf = (v) => (((Math.atan2(v[1], v[0]) * 180) / Math.PI) + 180) % 180;

export function nearestAxis(deg, tol) {
  let best = null;
  for (const [k, a] of Object.entries(AXES)) { const d = angDiff(deg, a); if (d < tol && (!best || d < best.d)) best = { k, d }; }
  return best && best.k;
}

export function intersect(p, d, q, e) {
  const det = d[0] * -e[1] - -e[0] * d[1];
  if (Math.abs(det) < 1e-9) return null;
  const rx = q[0] - p[0], ry = q[1] - p[1];
  const t = (rx * -e[1] - -e[0] * ry) / det;
  return [p[0] + d[0] * t, p[1] + d[1] * t];
}

/** 같은 축·같은 직선 위 선분을 하나로 합친다. */
export function collinearMerge(segs, offTol = 4.5, gap = 20) {
  const out = [];
  for (const ax of Object.keys(AXES)) {
    const d = unit(AXES[ax]), n = [-d[1], d[0]];
    const ss = segs.filter((s) => s.ax === ax).map((s) => ({ ...s, o: dot(n, mul(add(s.p0, s.p1), 0.5)) })).sort((a, b) => a.o - b.o);
    const groups = [];
    for (const s of ss) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g.o - s.o) < offTol) { g.items.push(s); g.o = g.items.reduce((t, q) => t + q.o, 0) / g.items.length; }
      else groups.push({ o: s.o, items: [s] });
    }
    for (const g of groups) {
      const iv = g.items.map((q) => {
        const a = dot(d, q.p0), b = dot(d, q.p1);
        return { lo: Math.min(a, b), hi: Math.max(a, b), w: q.w, o: q.o };
      }).sort((a, b) => a.lo - b.lo);
      let cur = { ...iv[0] };
      const acc = [cur];
      for (const q of iv.slice(1)) {
        if (q.lo <= cur.hi + gap) {
          const L1 = cur.hi - cur.lo, L2 = q.hi - q.lo, T = L1 + L2 + 1e-6;
          cur.o = (cur.o * L1 + q.o * L2) / T; cur.w = (cur.w * L1 + q.w * L2) / T;
          cur.hi = Math.max(cur.hi, q.hi);
        } else { cur = { ...q }; acc.push(cur); }
      }
      for (const q of acc) out.push({ ax, p0: add(mul(d, q.lo), mul(n, q.o)), p1: add(mul(d, q.hi), mul(n, q.o)), w: q.w });
    }
  }
  return out;
}

/** 끝점을 가까운 다른 축 선분과의 교점으로 늘이거나 자른다(모서리 맞춤). */
export function joinEndpoints(segs, tol = 10, minOther = 40) {
  for (const s of segs) {
    const d = unit(AXES[s.ax]);
    for (const end of ['p0', 'p1']) {
      const P = s[end];
      let best = null;
      for (const o of segs) {
        if (o === s || o.ax === s.ax) continue;
        const L = len(sub(o.p1, o.p0));
        if (L < minOther) continue;
        const e = unit(AXES[o.ax]);
        const X = intersect(s.p0, d, o.p0, e);
        if (!X) continue;
        const ou = dot(e, sub(X, o.p0)) * Math.sign(dot(e, sub(o.p1, o.p0)) || 1);
        if (ou < -2 || ou > L + 2) continue;
        const dist = len(sub(X, P));
        if (dist < tol && (!best || dist < best.dist)) best = { dist, X };
      }
      if (best) s[end] = best.X;
    }
  }
  return segs;
}

/** 다각형 변을 축 방향으로 맞추고, 같은 축 변을 합치고, 짧은 모따기를 없애 각진 모서리로 만든다. */
export function snapPoly(pts, tolDeg = 7, chamfer = 16) {
  const n = pts.length;
  if (n < 3) return pts;
  let edges = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], v = sub(b, a), L = len(v);
    if (L < 1e-6) continue;
    const ax = nearestAxis(angleOf(v), tolDeg);
    const dir = ax ? mul(unit(AXES[ax]), Math.sign(dot(unit(AXES[ax]), v)) || 1) : mul(v, 1 / L);
    edges.push({ m: mul(add(a, b), 0.5), d: dir, ax, L });
  }
  const mergeSame = () => {
    const m = [];
    for (const e of edges) {
      const last = m[m.length - 1];
      if (last && e.ax && last.ax === e.ax) { const T = last.L + e.L; last.m = mul(add(mul(last.m, last.L), mul(e.m, e.L)), 1 / T); last.L = T; }
      else m.push({ ...e });
    }
    if (m.length > 2 && m[0].ax && m[0].ax === m[m.length - 1].ax) {
      const a = m[0], b = m.pop(), T = a.L + b.L; a.m = mul(add(mul(a.m, a.L), mul(b.m, b.L)), 1 / T); a.L = T;
    }
    edges = m;
  };
  mergeSame();
  // 축 변 사이에 낀 짧은 비축 변(모따기) 제거
  for (let guard = 0; guard < 50 && edges.length > 3; guard++) {
    let changed = false;
    const N = edges.length;
    for (let i = 0; i < N && !changed; i++) {
      if (!edges[i].ax) continue;
      let j = (i + 1) % N, run = [], tot = 0;
      while (!edges[j].ax && run.length < N - 2) { run.push(j); tot += edges[j].L; j = (j + 1) % N; }
      if (run.length && edges[j].ax && tot < chamfer && run.length < N - 2) {
        const keep = new Set(run);
        edges = edges.filter((_, k) => !keep.has(k));
        changed = true;
      }
    }
    if (!changed) break;
    mergeSame();
  }
  if (edges.length < 3) return pts;
  const out = [];
  for (let i = 0; i < edges.length; i++) {
    const e1 = edges[(i - 1 + edges.length) % edges.length], e2 = edges[i];
    const X = intersect(e1.m, e1.d, e2.m, e2.d);
    if (!X || len(sub(X, e2.m)) > 4 * (e1.L + e2.L)) out.push(sub(e2.m, mul(e2.d, e2.L / 2)));
    else out.push(X);
  }
  return out;
}

/** Ramer–Douglas–Peucker */
export function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1], ab = sub(b, a), L = len(ab) || 1e-9;
    let best = -1, bi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs(ab[0] * (pts[i][1] - a[1]) - ab[1] * (pts[i][0] - a[0])) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > eps) { keep[bi] = 1; stack.push([i0, bi], [bi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 열린 폴리라인의 각 변을 축에 맞추고 이웃 변과 교점으로 다시 잇는다. */
export function snapPolyline(pts, tolDeg = 8) {
  if (pts.length < 2) return pts;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], v = sub(b, a), L = len(v);
    if (L < 1e-6) continue;
    const ax = nearestAxis(angleOf(v), tolDeg);
    const d = ax ? mul(unit(AXES[ax]), Math.sign(dot(unit(AXES[ax]), v)) || 1) : mul(v, 1 / L);
    segs.push({ m: mul(add(a, b), 0.5), d, ax, L, a, b });
  }
  if (!segs.length) return pts;
  // 같은 축 연속 변 합치기
  const m = [];
  for (const s of segs) {
    const last = m[m.length - 1];
    if (last && s.ax && last.ax === s.ax) { const T = last.L + s.L; last.m = mul(add(mul(last.m, last.L), mul(s.m, s.L)), 1 / T); last.L = T; last.b = s.b; }
    else m.push({ ...s });
  }
  const out = [];
  const proj = (s, p) => add(s.m, mul(s.d, dot(sub(p, s.m), s.d)));
  out.push(proj(m[0], m[0].a));
  for (let i = 1; i < m.length; i++) {
    const X = intersect(m[i - 1].m, m[i - 1].d, m[i].m, m[i].d);
    out.push(X && len(sub(X, m[i].a)) < 3 * Math.max(6, Math.min(m[i - 1].L, m[i].L)) ? X : m[i].a);
  }
  out.push(proj(m[m.length - 1], m[m.length - 1].b));
  return out;
}
