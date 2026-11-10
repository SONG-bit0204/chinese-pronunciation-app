// 성조 분석 엔진: 녹음 → 음높이(F0) 추적(YIN) → 음절 나누기 → 성조 판정
const Pitch = {
  SR: 16000, HOP: 160, WIN: 640, FMIN: 70, FMAX: 450,

  async decode(blob) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close();
    const ch = buf.getChannelData(0);
    return this.resample(ch, buf.sampleRate);
  },
  resample(x, sr) {
    const r = sr / this.SR, n = Math.floor(x.length / r), y = new Float32Array(n);
    let mean = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.floor(i * r), e = Math.max(s + 1, Math.min(x.length, Math.floor((i + 1) * r)));
      let a = 0; for (let j = s; j < e; j++) a += x[j];
      y[i] = a / (e - s); mean += y[i];
    }
    mean /= n || 1;
    for (let i = 0; i < n; i++) y[i] -= mean;
    return y;
  },

  // YIN 음높이 추정
  yin(x, off) {
    const tauMax = Math.ceil(this.SR / this.FMIN), tauMin = Math.floor(this.SR / this.FMAX), N = this.WIN - tauMax;
    const d = new Float32Array(tauMax + 2), c = new Float32Array(tauMax + 2);
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let s = 0;
      for (let j = 0; j < N; j++) { const v = x[off + j] - x[off + j + tau]; s += v * v; }
      d[tau] = s;
    }
    c[0] = 1; let run = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) { run += d[tau]; c[tau] = run > 0 ? d[tau] * tau / run : 1; }
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (c[t] < 0.15) { while (t + 1 <= tauMax && c[t + 1] < c[t]) t++; tau = t; break; }
    }
    if (tau < 0) { let m = Infinity; for (let t = tauMin; t <= tauMax; t++) if (c[t] < m) { m = c[t]; tau = t; } }
    let bt = tau;
    if (tau > tauMin && tau < tauMax) { const a = c[tau - 1], b = c[tau], g = c[tau + 1], den = a - 2 * b + g; if (den > 0) bt = tau + 0.5 * (a - g) / den; }
    return { f0: this.SR / bt, ap: c[tau] };
  },

  track(x) {
    const fr = [];
    for (let off = 0; off + this.WIN + 1 < x.length; off += this.HOP) {
      let e = 0; for (let j = 0; j < this.WIN; j++) e += x[off + j] * x[off + j];
      fr.push({ i: fr.length, off, rms: Math.sqrt(e / this.WIN), f0: null, v: false });
    }
    if (!fr.length) return { frames: fr, ok: false };
    const rs = fr.map(f => f.rms).sort((a, b) => a - b);
    const maxR = rs[rs.length - 1], noise = rs[Math.floor(rs.length * 0.1)];
    const thr = Math.max(maxR * 0.05, Math.min(noise * 2.5, maxR * 0.25), 0.002);
    fr.forEach(f => {
      f.act = f.rms > thr;
      if (f.act) { const r = this.yin(x, f.off); f.f0 = r.f0; f.ap = r.ap; f.v = r.ap < 0.3 && r.f0 > this.FMIN && r.f0 < this.FMAX; }
    });
    // 옥타브 오류 보정
    const med = median(fr.filter(f => f.v).map(f => f.f0));
    if (med) fr.forEach(f => { if (!f.v) return; if (f.f0 > med * 1.8) f.f0 /= 2; else if (f.f0 < med * 0.55) f.f0 *= 2; });
    // 중간값 필터 (튀는 값 제거)
    const raw = fr.map(f => f.f0);
    fr.forEach((f, i) => {
      if (!f.v) return;
      const w = []; for (let k = i - 2; k <= i + 2; k++) if (fr[k] && fr[k].v) w.push(raw[k]);
      f.f0 = median(w);
    });
    // 에너지 곡선 (부드럽게)
    fr.forEach((f, i) => { let s = 0, n = 0; for (let k = i - 2; k <= i + 2; k++) if (fr[k]) { s += fr[k].rms; n++; } f.env = s / n; });
    return { frames: fr, thr, med, ok: fr.filter(f => f.v).length >= 4 };
  },

  // 유성음 구간을 기준으로 N개 음절로 나누기
  segment(fr, N) {
    let runs = [], cur = null, gap = 0;
    fr.forEach((f, i) => {
      if (f.v) { if (cur && gap <= 2) cur.e = i; else { cur = { s: i, e: i }; runs.push(cur); } gap = 0; }
      else gap++;
    });
    runs = runs.filter(r => r.e - r.s + 1 >= 4);
    if (!runs.length || N <= 0) return [];
    const len = r => r.e - r.s + 1;
    // 모자라면: 가장 긴 구간을 에너지가 가장 깊게 꺼지는 곳에서 나눔
    let guard = 0;
    while (runs.length < N && guard++ < 50) {
      let li = 0; runs.forEach((r, i) => { if (len(r) > len(runs[li])) li = i; });
      const r = runs[li]; if (len(r) < 10) break;
      let best = -1, bv = Infinity;
      for (let k = r.s + 5; k <= r.e - 5; k++) {
        let mL = 0, mR = 0;
        for (let j = r.s; j < k; j++) mL = Math.max(mL, fr[j].env);
        for (let j = k + 1; j <= r.e; j++) mR = Math.max(mR, fr[j].env);
        const ratio = fr[k].env / (Math.min(mL, mR) || 1);
        // 음높이가 크게 끊기는 곳도 경계 후보
        const jump = fr[k + 1].v && fr[k].v ? Math.abs(12 * Math.log2(fr[k + 1].f0 / fr[k].f0)) : 0;
        const v = ratio - Math.min(jump, 4) * 0.08;
        if (v < bv) { bv = v; best = k; }
      }
      if (best < 0 || bv > 0.93) best = Math.floor((r.s + r.e) / 2);
      runs.splice(li, 1, { s: r.s, e: best }, { s: best + 1, e: r.e });
    }
    // 많으면: 아주 짧은 조각을 먼저 버리고, 그다음 간격이 가장 좁은 이웃끼리 합침
    guard = 0;
    while (runs.length > N && guard++ < 50) {
      const tiny = runs.findIndex(r => len(r) < 6);
      if (tiny >= 0 && runs.length > N) { runs.splice(tiny, 1); continue; }
      let gi = 0, gv = Infinity;
      for (let i = 0; i < runs.length - 1; i++) { const g = runs[i + 1].s - runs[i].e; if (g < gv) { gv = g; gi = i; } }
      runs.splice(gi, 2, { s: runs[gi].s, e: runs[gi + 1].e });
    }
    return runs;
  },

  // 음절 하나의 음높이 모양
  features(fr, run, prof) {
    const vf = []; for (let i = run.s; i <= run.e; i++) if (fr[i].v) vf.push(fr[i]);
    if (vf.length < 4) return null;
    const a = Math.floor(vf.length * 0.12), b = Math.max(a + 3, Math.ceil(vf.length * 0.92));
    const core = vf.slice(a, b);
    const st = core.map(f => 12 * Math.log2(f.f0 / prof.ref));
    const norm = s => (s - prof.lo) / (prof.hi - prof.lo);
    const bins = (arr, k) => { const o = []; for (let i = 0; i < k; i++) { const s = Math.floor(i * arr.length / k), e = Math.max(s + 1, Math.floor((i + 1) * arr.length / k)); o.push(arr.slice(s, e).reduce((x, y) => x + y, 0) / (e - s)); } return o; };
    const st5 = bins(st, 5);
    return { st5, h5: st5.map(norm), plot: bins(st, Math.min(24, st.length)).map(norm), dur: (run.e - run.s + 1) * this.HOP / this.SR, hz: median(core.map(f => f.f0)) };
  },

  TEMPL: { 1: [.85, .85, .85, .85, .85], 2: [.38, .4, .5, .68, .88], 3: [.3, .17, .08, .06, .08], '3f': [.35, .15, .06, .2, .48], 4: [.95, .82, .62, .42, .22] },
  classify(F) {
    const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
    const hm = mean(F.h5);
    const scores = Object.entries(this.TEMPL).map(([t, tp]) => {
      const tm = mean(tp);
      let shape = 0; for (let i = 0; i < 5; i++) { const dv = (F.h5[i] - hm) - (tp[i] - tm); shape += dv * dv; }
      const level = (hm - tm) * (hm - tm);
      return { t: t === '3f' ? 3 : +t, d: shape / 5 * 4 + level * 0.6 };
    }).sort((a, b) => a.d - b.d);
    const best = scores[0], second = scores.find(s => s.t !== best.t);
    const conf = Math.max(0, Math.min(1, (second.d - best.d) / (second.d + 0.01)));
    return { tone: best.t, conf, fall: F.st5[0] - F.st5[4] };
  }
};

function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function pct(a, p) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

// 내 음역(목소리 높낮이 범위) — 연습할수록 정확해짐
const Voice = {
  KEY: 'zh-pron-voice',
  pool() { try { return JSON.parse(localStorage.getItem(this.KEY)) || []; } catch (e) { return []; } },
  add(hzList) {
    let p = this.pool().concat(hzList.filter((_, i) => i % 2 === 0).map(v => Math.round(v * 10) / 10));
    if (p.length > 3000) p = p.slice(p.length - 3000);
    try { localStorage.setItem(this.KEY, JSON.stringify(p)); } catch (e) { }
  },
  reset() { try { localStorage.removeItem(this.KEY); } catch (e) { } },
  learned() { return this.pool().length >= 250; },
  // 기준 음높이와 범위 (반음 단위)
  profile(curHz) {
    const pool = this.pool();
    const src = pool.length >= 250 ? pool : pool.concat(curHz);
    const ref = median(src) || 150;
    const st = src.map(h => 12 * Math.log2(h / ref));
    let lo = pct(st, 0.08), hi = pct(st, 0.92);
    if (hi - lo < 8) { const mid = (hi + lo) / 2; lo = Math.min(lo, mid - 4.5); hi = Math.max(hi, mid + 4.5); }
    return { ref, lo, hi, learned: pool.length >= 250 };
  }
};

// 기대 성조 계산 (3성 연속 변화 포함)
function expectedTones(nums) {
  const t = nums.slice(), alt = nums.map(() => null), sandhi = nums.map(() => false);
  let i = 0;
  while (i < t.length) {
    if (t[i] === 3) {
      let j = i; while (j + 1 < t.length && t[j + 1] === 3) j++;
      for (let k = i; k < j; k++) { t[k] = 2; sandhi[k] = true; if (j - i >= 2) alt[k] = 3; }
      i = j + 1;
    } else i++;
  }
  return t.map((v, k) => ({ tone: v, alt: alt[k], sandhi: sandhi[k] }));
}

// 전체 분석
async function analyzeRecording(blob, sylls) {
  const x = await Pitch.decode(blob);
  const tr = Pitch.track(x);
  const graded = sylls.length;
  if (!tr.ok) return { ok: false, reason: '목소리가 잘 들리지 않았어요. 마이크에 조금 더 가까이, 크게 말해 보세요.' };
  const voicedHz = tr.frames.filter(f => f.v).map(f => f.f0);
  const prof = Voice.profile(voicedHz);
  const runs = Pitch.segment(tr.frames, graded);
  const res = sylls.map((s, k) => {
    const run = runs[k];
    const F = run ? Pitch.features(tr.frames, run, prof) : null;
    const C = F ? Pitch.classify(F) : null;
    return Object.assign({}, s, { F, got: C ? C.tone : null, conf: C ? C.conf : 0 });
  });
  Voice.add(voicedHz);
  const dur = tr.frames.length * Pitch.HOP / Pitch.SR;
  return { ok: true, res, prof, segCount: runs.length, dur };
}
