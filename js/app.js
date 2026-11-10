// 중국어 발음 체크 — 성조 분석 + 번역·발음
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const on = (root, sel, fn) => $$(sel, root).forEach(e => e.addEventListener('click', ev => fn(e, ev)));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600); }
function playUrl(url) { return new Promise(res => { const a = new Audio(url); a.onended = res; a.onerror = res; a.play().catch(res); }); }
const HZ = /[㐀-鿿]/;
const TONE_MARK = ['경성', '1성 ˉ', '2성 ˊ', '3성 ˇ', '4성 ˋ'];

// ───── 저장 ─────
const KEY = 'zh-pron-v1';
const Store = {
  s: null,
  load() {
    let r = null; try { r = JSON.parse(localStorage.getItem(KEY)); } catch (e) { }
    this.s = Object.assign({ attempts: [], conf: {}, chars: {}, trans: [], settings: { stt: true, auto: true } }, r || {});
  },
  save() { try { localStorage.setItem(KEY, JSON.stringify(this.s)); } catch (e) { } }
};

// 입문 학습 앱의 단어 사전과 진도
const WORDS = {};
(window.COURSE ? COURSE.days : []).forEach(d => (d.words || []).forEach(w => { const [hz, py, ko] = w.split('|'); if (!WORDS[hz]) WORDS[hz] = { hz, py, ko, day: d.day }; }));
function introState() { try { return JSON.parse(localStorage.getItem('zh-intro-v1')); } catch (e) { return null; } }
function pushIntroWrong(s) {
  try {
    const st = introState(); if (!st) return;
    st.wrong = st.wrong || {};
    const id = 'tone:' + s.hz + s.py;
    const day = Math.min(st.day || 1, 30), week = (COURSE.days[day - 1] || {}).week || 1;
    const w = st.wrong[id] || { id, type: 'tone', key: s.hz + s.py, count: 0, first: today(), label: s.hz + ' ' + s.py, sub: '발음 체크에서 성조가 다르게 들림', speak: s.hz, cat: 'tone', week };
    w.count++; w.last = today(); w.resolved = false;
    st.wrong[id] = w;
    localStorage.setItem('zh-intro-v1', JSON.stringify(st));
  } catch (e) { }
}

// ───── 음성 합성 ─────
const TTS = {
  voice: null, good: false, audio: null,
  // 휴대폰은 중국어 음성이 없으면 한국어 음성이 한자를 한국식으로 읽어 버림 (你好 → "호")
  // → 휴대폰에서는 인터넷이 되면 온라인 원어민 음성을 쓰고, 안 되면 기기 음성 사용
  mobile: /Android|iPhone|iPad|iPod/i.test(navigator.userAgent),
  init() {
    if (!('speechSynthesis' in window)) return;
    const pick = () => {
      const vs = speechSynthesis.getVoices();
      const zh = vs.filter(v => /^(zh|cmn)([-_](Hans[-_])?CN)?$/i.test(v.lang) || /^(zh|cmn)[-_](Hans[-_])?CN/i.test(v.lang));
      this.voice = zh.find(v => /Xiaoxiao|Natural|Online/i.test(v.name)) || zh[0] || null;
      this.good = !!this.voice;
    };
    pick(); speechSynthesis.onvoiceschanged = pick;
  },
  useOnline() { return this.mobile ? navigator.onLine !== false : !this.good && navigator.onLine !== false; },
  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (this.audio) { this.audio.pause(); this.audio = null; }
  },
  speak(text, rate) {
    this.stop();
    if (this.useOnline()) return this.online(text, rate).catch(() => this.local(text, rate));
    return this.local(text, rate);
  },
  local(text, rate) {
    return new Promise(res => {
      if (!('speechSynthesis' in window)) return res();
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; if (this.voice) u.voice = this.voice; u.rate = (rate || 1) * 0.9;
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      u.onend = fin; u.onerror = fin; setTimeout(fin, 20000);
      setTimeout(() => speechSynthesis.speak(u), 40);
    });
  },
  // 온라인 원어민 음성: Google 번역 음성 → 안 되면 Youdao 사전 음성 (문장이 해당 서버로 전송됨)
  async online(text, rate) {
    const parts = (text.match(/[^。！？!?，,；;]+[。！？!?，,；;]?/g) || [text]).map(x => x.trim()).filter(Boolean);
    for (const part of parts) {
      const q = encodeURIComponent(part.slice(0, 180));
      const urls = [`https://translate.googleapis.com/translate_tts?ie=UTF-8&tl=zh-CN&client=gtx&q=${q}`, `https://dict.youdao.com/dictvoice?audio=${q}&le=zh`];
      let ok = false;
      for (const url of urls) { try { await this.play(url, rate); ok = true; break; } catch (e) { if (e === 'stopped') return; } }
      if (!ok) throw new Error('online tts failed');
    }
  },
  play(url, rate) {
    return new Promise((res, rej) => {
      const a = new Audio(); this.audio = a;
      a.referrerPolicy = 'no-referrer'; a.preload = 'auto';
      a.defaultPlaybackRate = a.playbackRate = Math.max(0.5, (rate || 1) * 0.9);
      let started = false;
      const t = setTimeout(() => { if (!started) { a.pause(); rej('timeout'); } }, 8000);
      a.onplaying = () => { started = true; clearTimeout(t); };
      a.onended = () => { clearTimeout(t); res(); };
      a.onerror = () => { clearTimeout(t); rej('error'); };
      a.onpause = () => { if (started && !a.ended && this.audio !== a) { clearTimeout(t); rej('stopped'); } };
      a.src = url;
      const p = a.play(); if (p && p.catch) p.catch(() => { clearTimeout(t); rej('error'); });
    });
  }
};

// ───── 병음 ─────
function pinyinOk() { return !!(window.pinyinPro && pinyinPro.pinyin); }
function toSyllables(text) {
  const hz = [...text].filter(c => HZ.test(c)).join('');
  if (!hz) return [];
  const py = pinyinPro.pinyin(hz, { type: 'array' });
  const num = pinyinPro.pinyin(hz, { type: 'array', toneType: 'num' });
  const out = [];
  [...hz].forEach((c, i) => {
    const m = /(\d)$/.exec(num[i] || ''); const t = m ? +m[1] : 0;
    const prev = out[out.length - 1];
    if (c === '儿' && prev && (i === hz.length - 1 || /[哪这那点会玩块]/.test(prev.hz.slice(-1)))) { prev.hz += '儿'; prev.py += 'r'; return; }
    out.push({ hz: c, py: py[i] || '', bare: (num[i] || '').replace(/\d/g, ''), tone: t === 5 ? 0 : t });
  });
  const exp = expectedTones(out.map(s => s.tone));
  out.forEach((s, i) => Object.assign(s, { exp: exp[i].tone, alt: exp[i].alt, sandhi: exp[i].sandhi }));
  return out;
}
function rubyHtml(text) {
  if (!pinyinOk()) return esc(text);
  const chars = [...text];
  const py = pinyinPro.pinyin(text, { type: 'array' }), num = pinyinPro.pinyin(text, { type: 'array', toneType: 'num' });
  return chars.map((c, i) => {
    if (!HZ.test(c)) return esc(c);
    const m = /(\d)$/.exec(num[i] || ''); const t = m && m[1] !== '5' ? m[1] : 0;
    return `<ruby>${esc(c)}<rt class="t${t}">${esc(py[i])}</rt></ruby>`;
  }).join('');
}
function pinyinLine(text) {
  if (!pinyinOk()) return '';
  const words = text.replace(/[^㐀-鿿，。！？、,.!?]/g, '');
  const py = pinyinPro.pinyin(words, { type: 'array' }), num = pinyinPro.pinyin(words, { type: 'array', toneType: 'num' });
  return [...words].map((c, i) => { if (!HZ.test(c)) return esc(c); const m = /(\d)$/.exec(num[i] || ''); return `<span class="t${m && m[1] !== '5' ? m[1] : 0}">${esc(py[i])}</span>`; }).join(' ');
}

// ───── 음성 인식 (Chrome 내장) ─────
const STT = {
  ctor: window.SpeechRecognition || window.webkitSpeechRecognition,
  ok() { return !!this.ctor; },
  start(lang, onText) {
    if (!this.ok()) return null;
    const r = new this.ctor(); r.lang = lang; r.continuous = true; r.interimResults = !!onText; r.maxAlternatives = 3;
    const job = { r, text: '', alts: [], done: null, err: null };
    job.done = new Promise(res => {
      r.onresult = e => {
        let fin = '', interim = '';
        for (let i = 0; i < e.results.length; i++) {
          const rs = e.results[i];
          if (rs.isFinal) { fin += rs[0].transcript; job.alts.push([...rs].map(a => a.transcript)); } else interim += rs[0].transcript;
        }
        job.text = fin; onText && onText(fin + interim);
      };
      r.onerror = e => { job.err = e.error; };
      r.onend = () => res(job);
    });
    try { r.start(); } catch (e) { return null; }
    return job;
  },
  async stop(job) { if (!job) return null; try { job.r.stop(); } catch (e) { } await Promise.race([job.done, sleep(4000)]); return job; }
};

// ───── 녹음 ─────
const Mic = {
  async start(onLevel, onAutoStop) {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    this.mr = new MediaRecorder(this.stream);
    this.mr.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
    this.mr.start();
    this.t0 = Date.now();
    this.ctx = new AudioContext();
    const an = this.ctx.createAnalyser(); an.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    let spoke = false, quietSince = 0;
    const loop = () => {
      if (!this.mr || this.mr.state !== 'recording') return;
      an.getFloatTimeDomainData(buf);
      let e = 0; for (const v of buf) e += v * v; const rms = Math.sqrt(e / buf.length);
      onLevel && onLevel(Math.min(1, rms * 8));
      const now = Date.now();
      if (rms > 0.03) { spoke = true; quietSince = 0; }
      else if (spoke && rms < 0.012) { if (!quietSince) quietSince = now; if (now - quietSince > 1300 && onAutoStop) return onAutoStop(); }
      if (now - this.t0 > 15000 && onAutoStop) return onAutoStop();
      this.raf = requestAnimationFrame(loop);
    };
    loop();
  },
  stop() {
    return new Promise(res => {
      if (!this.mr || this.mr.state !== 'recording') return res(null);
      cancelAnimationFrame(this.raf);
      this.mr.onstop = () => {
        this.stream.getTracks().forEach(t => t.stop());
        this.ctx && this.ctx.close();
        res(new Blob(this.chunks, { type: this.mr.mimeType || 'audio/webm' }));
        this.mr = null;
      };
      this.mr.stop();
    });
  },
  active() { return !!(this.mr && this.mr.state === 'recording'); }
};

// ───── 피드백 문구 ─────
const TIPS = {
  '1-2': '1성은 처음부터 끝까지 높고 평평하게 유지하세요. 끝이 올라갔어요.',
  '1-3': '1성인데 낮게 들렸어요. 평소보다 높은 음으로 시작해 쭉 유지하세요.',
  '1-4': '1성인데 끝이 떨어졌어요. "솔~"처럼 같은 높이로 길게 끌어 주세요.',
  '2-1': '2성은 아래에서 위로 올라가야 해요. 평평하게 들렸어요 — 되묻는 "응?"처럼.',
  '2-3': '2성이 3성처럼 낮게 들렸어요. 중간 높이에서 시작해 끝을 확실히 올리세요.',
  '2-4': '2성인데 내려갔어요. 끝을 위로 올려 주세요.',
  '3-1': '3성은 낮게 깔아야 해요. 너무 높고 평평하게 들렸어요.',
  '3-2': '3성이 2성처럼 올라갔어요. 바닥까지 낮게 눌러 주세요.',
  '3-4': '3성인데 위에서 떨어졌어요. 처음부터 낮은 음으로 시작하세요.',
  '4-1': '4성은 위에서 아래로 뚝 떨어져야 해요. 평평하게 들렸어요.',
  '4-2': '4성인데 올라갔어요. 단호하게 내려 주세요 — "야!"처럼.',
  '4-3': '4성이 낮게 들렸어요. 높은 곳에서 시작해 아래로 떨어뜨리세요.'
};
const PAIR_TIPS = {
  'z|zh': 'zh는 혀끝을 말아 올리고, z는 혀끝을 윗니 뒤에 대요.',
  'c|ch': 'ch는 혀끝을 말아 올리고, c는 혀끝을 윗니 뒤에 대요.',
  's|sh': 'sh는 혀끝을 말아 올리고, s는 혀끝을 윗니 뒤에 대요.',
  'l|n': 'n은 코로 울리는 소리, l은 혀끝을 잇몸에 대고 옆으로 흘리는 소리예요.',
  'l|r': 'r은 혀끝을 말아 올린 채 살짝 떨림 없이, l은 혀끝을 잇몸에 붙여요.',
  'f|h': 'f는 윗니를 아랫입술에 대고, h는 목 안쪽에서 바람을 내요.',
  'b|p': 'p는 숨을 세게 내뱉고, b는 숨을 약하게 내요.',
  'd|t': 't는 숨을 세게 내뱉고, d는 숨을 약하게 내요.',
  'g|k': 'k는 숨을 세게 내뱉고, g는 숨을 약하게 내요.',
  'j|q': 'q는 숨을 세게 내뱉고, j는 숨을 약하게 내요.',
  'j|zh': 'j는 혀를 아랫니 뒤에 납작하게, zh는 혀끝을 말아 올려요.',
  'q|ch': 'q는 혀를 아랫니 뒤에 납작하게, ch는 혀끝을 말아 올려요.',
  'sh|x': 'x는 혀를 아랫니 뒤에 납작하게, sh는 혀끝을 말아 올려요.',
  'an|ang': '-n은 혀끝이 윗잇몸에 닿으며 끝나고, -ng은 입을 벌린 채 목 안쪽에서 끝나요.',
  'en|eng': '-n은 혀끝이 윗잇몸에 닿으며 끝나고, -ng은 입을 벌린 채 목 안쪽에서 끝나요.',
  'in|ing': '-n은 혀끝이 윗잇몸에 닿으며 끝나고, -ng은 입을 벌린 채 목 안쪽에서 끝나요.',
  'ian|iang': '-n은 혀끝이 윗잇몸에 닿으며 끝나고, -ng은 입을 벌린 채 목 안쪽에서 끝나요.',
  'u|ü': 'ü는 "위" 입술 모양을 끝까지 유지해요 (j q x y 뒤의 u는 ü예요).'
};
function splitPy(p) {
  p = (p || '').replace(/\d/g, '').replace('v', 'ü');
  const m = p.match(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(.*)$/);
  let i = m[1] || '', f = m[2];
  if (/[jqxy]/.test(i) && f.startsWith('u')) f = 'ü' + f.slice(1);
  return { i, f };
}
function diagnose(tc, gc) {
  if (!pinyinOk()) return '';
  const tp = pinyinPro.pinyin(tc, { toneType: 'num' }), gp = pinyinPro.pinyin(gc, { toneType: 'num' });
  const a = splitPy(tp), b = splitPy(gp);
  const k = (x, y) => [x, y].sort().join('|');
  const nm = s => s.replace(/\d/g, '');
  if (nm(tp) === nm(gp)) return `소리는 같고 성조가 달라 "${gc}"(${pinyinPro.pinyin(gc)})로 들렸을 수 있어요.`;
  const tips = [];
  if (a.i !== b.i) tips.push(`첫소리 ${a.i || '없음'} → ${b.i || '없음'}` + (PAIR_TIPS[k(a.i, b.i)] ? ' — ' + PAIR_TIPS[k(a.i, b.i)] : ''));
  if (a.f !== b.f) {
    const fk = [['an', 'ang'], ['en', 'eng'], ['in', 'ing'], ['ian', 'iang'], ['u', 'ü']].find(([x, y]) => k(a.f, b.f) === k(x, y) || (a.f.endsWith(x) && b.f.endsWith(y) && a.f.slice(0, -x.length) === b.f.slice(0, -y.length)) || (a.f.endsWith(y) && b.f.endsWith(x) && a.f.slice(0, -y.length) === b.f.slice(0, -x.length)));
    tips.push(`모음 ${a.f} → ${b.f}` + (fk ? ' — ' + PAIR_TIPS[k(fk[0], fk[1])] : ''));
  }
  return tips.join(' / ');
}
// 글자 단위 정렬 (편집 거리)
function align(a, b) {
  const n = a.length, m = b.length, D = Array.from({ length: n + 1 }, (_, i) => Array(m + 1).fill(0).map((_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) D[i][j] = Math.min(D[i - 1][j] + 1, D[i][j - 1] + 1, D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  const ops = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) { ops.unshift({ t: a[i - 1] === b[j - 1] ? 'eq' : 'sub', a: a[i - 1], b: b[j - 1] }); i--; j--; }
    else if (i > 0 && D[i][j] === D[i - 1][j] + 1) { ops.unshift({ t: 'del', a: a[i - 1] }); i--; }
    else { ops.unshift({ t: 'ins', b: b[j - 1] }); j--; }
  }
  return { ops, dist: D[n][m] };
}

// ───── 음높이 그래프 ─────
function pitchChart(res) {
  const n = res.length, W = Math.max(320, n * 70), H = 190, top = 14, bot = 150, colW = W / n;
  const y = h => bot - Math.max(-0.15, Math.min(1.15, h)) * (bot - top);
  let s = `<svg class="pchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="음높이 그래프">`;
  s += `<rect class="band" x="0" y="${y(1)}" width="${W}" height="${y(0.6) - y(1)}"/><rect class="band" x="0" y="${y(0.4)}" width="${W}" height="${y(0) - y(0.4)}"/>`;
  s += `<text x="4" y="${y(0.92)}">높음</text><text x="4" y="${y(0.06)}">낮음</text>`;
  res.forEach((r, k) => {
    const x0 = k * colW + 10, x1 = (k + 1) * colW - 10;
    if (k) s += `<line class="sep" x1="${k * colW}" x2="${k * colW}" y1="${top}" y2="${bot}"/>`;
    const tp = r.exp ? Pitch.TEMPL[r.exp === 3 && k === n - 1 ? '3f' : r.exp] : null;
    if (tp) s += `<polyline class="tmpl" points="${tp.map((v, i) => `${(x0 + (x1 - x0) * i / 4).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
    if (r.F && r.F.plot.length > 1) s += `<polyline class="mine ${r.exp === 0 || r.okTone ? 'ok' : 'ng'}" points="${r.F.plot.map((v, i) => `${(x0 + (x1 - x0) * i / (r.F.plot.length - 1)).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`;
    s += `<text class="hz" x="${k * colW + colW / 2}" y="${H - 18}" text-anchor="middle">${esc(r.hz)}</text><text x="${k * colW + colW / 2}" y="${H - 3}" text-anchor="middle">${esc(r.py)}</text>`;
  });
  return s + '</svg>';
}

// ───── 앱 ─────
const App = {
  tab: 'practice', target: null, result: null, busy: false, lastBlobUrl: null,
  init() {
    Store.load(); TTS.init();
    $$('#tabs button').forEach(b => b.onclick = () => this.go(b.dataset.tab));
    document.addEventListener('click', e => { const sy = e.target.closest('[data-say]'); if (sy) TTS.speak(sy.dataset.say, +(sy.dataset.rate || 1)); });
    const h = decodeURIComponent(location.hash.replace(/^#t=/, ''));
    if (h && HZ.test(h)) this.setTarget(h);
    this.go('practice');
  },
  go(tab) {
    if (Mic.active()) Mic.stop();
    this.tab = tab;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    Views[tab]($('#view'));
    scrollTo(0, 0);
  },
  setTarget(text) {
    text = text.trim();
    if (!pinyinOk()) { toast('병음 라이브러리를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'); return false; }
    const sylls = toSyllables(text);
    if (!sylls.length) { toast('한자로 된 문장이나 단어를 넣어 주세요.'); return false; }
    if (sylls.length > 20) { toast('20글자 이하로 나눠서 연습해 주세요.'); return false; }
    this.target = { text, sylls }; this.result = null;
    return true;
  }
};

const Views = {
  practice(el) {
    const st = Store.s, t = App.target;
    const intro = introState();
    const options = buildOptions(intro);
    const voiceN = Voice.pool().length;
    el.innerHTML = `
      <div class="card">
        <div class="eyebrow">연습할 문장·단어</div>
        <div class="target-input"><input class="inp" id="tin" placeholder="예: 你好 / 我是韩国人。" value="${t ? esc(t.text) : ''}" aria-label="연습할 중국어"><button class="btn" id="tset">확인</button></div>
        <div class="row wrap">
          <select class="inp" id="tsel" aria-label="목록에서 고르기"><option value="">목록에서 고르기…</option>${options}</select>
          ${intro ? `<button class="btn sm ghost" id="ttoday">오늘 일차 문장</button>` : ''}
          <button class="btn sm ghost" id="tcal">妈麻马骂</button>
        </div>
        ${!pinyinOk() ? '<div class="note warn">병음 라이브러리를 불러오지 못했어요. 인터넷에 연결한 뒤 새로고침해 주세요.</div>' : ''}
      </div>
      ${t ? `<div class="card center">
        <div class="sylls">${t.sylls.map((s, i) => { const r = App.result && App.result.ok ? App.result.res[i] : null; const cls = r ? (s.exp === 0 ? 'skip' : r.okTone ? 'ok' : 'ng') : ''; return `<div class="syl ${cls}">
          <span class="hz">${esc(s.hz)}</span><span class="p t${s.exp}">${esc(s.py)}</span>
          <span class="tn">${s.exp === 0 ? '경성' : TONE_MARK[s.exp]}${s.sandhi ? ' (3성 변화)' : ''}</span>
          ${r && s.exp !== 0 ? `<span class="got ${r.okTone ? 'ok' : 'bad'}">${r.got ? '들림: ' + TONE_MARK[r.got] : '분석 안 됨'}</span>` : ''}</div>`; }).join('')}</div>
        <div class="row center"><button class="btn sm ghost" data-say="${esc(t.text)}">🔊 원어민</button><button class="btn sm ghost" data-say="${esc(t.text)}" data-rate="0.6">🐢 천천히</button></div>
        <button class="rec-big" id="rec" aria-label="녹음">🎙</button>
        <div class="meter"><i id="lvl"></i></div>
        <p class="muted small" id="rmsg">${App.busy ? '분석 중…' : '버튼을 누르고 말하세요. 말이 끝나면 자동으로 멈춰요.'}</p>
      </div>
      <div id="result"></div>` : `<div class="empty">연습할 중국어 문장이나 단어를 넣거나, 목록에서 골라 주세요.<br><span class="small">번역·발음 탭에서 한국어 문장을 중국어로 바꿔서 가져올 수도 있어요.</span></div>`}
      ${voiceN < 250 ? `<div class="note">🎚 내 목소리 높이를 배우는 중이에요 (${Math.min(100, Math.round(voiceN / 2.5))}%). 처음 몇 번은 판정이 덜 정확해요. <b>妈麻马骂</b>를 몇 번 녹음하면 빨리 배워요.</div>` : ''}`;
    const setAndDraw = txt => { if (App.setTarget(txt)) Views.practice(el); };
    $('#tset', el).onclick = () => setAndDraw($('#tin', el).value);
    $('#tin', el).onkeydown = e => { if (e.key === 'Enter') setAndDraw(e.target.value); };
    $('#tsel', el).onchange = e => { if (e.target.value) setAndDraw(e.target.value); };
    $('#tcal', el).onclick = () => setAndDraw('妈麻马骂');
    const td = $('#ttoday', el);
    if (td) td.onclick = () => { const d = COURSE.days[Math.min(intro.day || 1, 30) - 1]; const pool = (d.sents || d.alt || []).concat(d.type !== 'lesson' ? COURSE.days.filter(x => x.week === d.week && x.sents).flatMap(x => x.sents) : []); const s = pool[Math.floor(Math.random() * pool.length)]; if (s) setAndDraw(s[0]); };
    if (t) {
      $('#rec', el).onclick = () => recordAndAnalyze(el);
      if (App.result) renderResult($('#result', el));
    }
  },

  translate(el) {
    const st = Store.s;
    el.innerHTML = `
      <div class="card">
        <div class="eyebrow">한국어 → 중국어</div>
        <textarea class="tr-in" id="trin" placeholder="한국어로 쓰거나 🎙를 눌러 말해 보세요. 중국어를 넣으면 발음만 보여 줘요.">${esc(App.trText || '')}</textarea>
        <div class="row wrap"><button class="btn" id="trgo">중국어로 바꾸기</button><button class="btn ghost" id="trmic">🎙 한국어로 말하기</button></div>
        <p class="muted small" id="trmsg">PC의 Edge·Chrome에서는 내장 번역(인터넷 없이도 가능)을, 휴대폰에서는 온라인 번역(Google 번역 서버로 문장 전송, 인터넷 필요)을 써요.</p>
      </div>
      <div id="trout"></div>
      ${st.trans.length ? `<div class="card"><div class="eyebrow">최근 번역</div>${st.trans.slice(0, 15).map((x, i) => `<div class="hist-item"><div><div class="zh">${esc(x.zh)}</div><div class="muted small">${esc(x.src)}</div></div><button class="btn sm ghost" data-h="${i}">다시 보기</button></div>`).join('')}</div>` : ''}`;
    $('#trgo', el).onclick = () => doTranslate(el);
    on(el, '[data-h]', b => { const x = st.trans[+b.dataset.h]; App.trText = x.src; Views.translate(el); showTranslation($('#trout', el), x.src, x.zh); });
    const mic = $('#trmic', el);
    mic.onclick = async () => {
      if (!STT.ok()) return toast('이 브라우저는 음성 입력을 지원하지 않아요. Chrome이나 Edge를 써 주세요.');
      if (App.trJob) { mic.textContent = '🎙 한국어로 말하기'; mic.classList.remove('rec-on'); const j = await STT.stop(App.trJob); App.trJob = null; if (j && j.text) { $('#trin', el).value = j.text; doTranslate(el); } else if (j && j.err) toast('음성 인식 오류: ' + j.err); return; }
      App.trJob = STT.start('ko-KR', txt => { $('#trin', el).value = txt; });
      if (!App.trJob) return toast('음성 입력을 시작하지 못했어요.');
      mic.textContent = '■ 말하기 끝'; mic.classList.add('rec-on');
      App.trJob.done.then(j => { if (App.trJob === j) { App.trJob = null; mic.textContent = '🎙 한국어로 말하기'; mic.classList.remove('rec-on'); if (j.text) { $('#trin', el).value = j.text; doTranslate(el); } } });
    };
    if (App.trLast) showTranslation($('#trout', el), App.trLast.src, App.trLast.zh);
  },

  stats(el) {
    const st = Store.s, at = st.attempts;
    const all = at.flatMap(a => a.tones || []);
    const acc = all.length ? Math.round(all.filter(x => x.ok).length / all.length * 100) : 0;
    const byTone = [1, 2, 3, 4].map(t => { const xs = all.filter(x => x.exp === t); return { t, n: xs.length, ok: xs.filter(x => x.ok).length }; });
    const conf = Object.entries(st.conf).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const weak = Object.entries(st.chars).filter(([, v]) => v.t - v.ok > 0).sort((a, b) => (b[1].t - b[1].ok) - (a[1].t - a[1].ok)).slice(0, 10);
    const tdy = at.filter(a => a.date === today()).length;
    el.innerHTML = `<h2 class="page-title">발음 기록</h2>
      <div class="tiles"><div class="tile"><b>${at.length}</b><span>연습 횟수</span></div><div class="tile"><b>${all.length ? acc + '%' : '—'}</b><span>성조 정확도</span></div><div class="tile"><b>${tdy}</b><span>오늘 연습</span></div></div>
      <div class="card"><div class="eyebrow">성조별 정확도</div><div class="sbars tone-bars">${byTone.map(b => `<div class="sbar"><span class="sl t${b.t}"><b>${b.t}성</b></span><span class="bar"><i style="width:${b.n ? b.ok / b.n * 100 : 0}%"></i></span><span class="sv">${b.n ? Math.round(b.ok / b.n * 100) + '% (' + b.n + ')' : '—'}</span></div>`).join('')}</div></div>
      <div class="card"><div class="eyebrow">자주 헷갈리는 성조</div>${conf.length ? `<ul class="plain">${conf.map(([k, n]) => { const [e, g] = k.split('-'); return `<li><b>${e}성</b>을 <b>${g}성</b>처럼 — ${n}회<div class="muted small">${TIPS[k] || ''}</div></li>`; }).join('')}</ul>` : '<p class="muted small">아직 기록이 없어요.</p>'}</div>
      <div class="card"><div class="eyebrow">약한 글자</div>${weak.length ? `<div class="wchips">${weak.map(([hz, v]) => `<button class="wchip" data-p="${esc(hz)}"><span class="zh">${esc(hz)}</span> <span class="py show">${esc(v.py)}</span> <span class="muted small">${v.t - v.ok}/${v.t}회 틀림</span></button>`).join('')}</div><p class="muted small">누르면 그 글자를 연습해요.</p>` : '<p class="muted small">아직 기록이 없어요.</p>'}</div>
      <div class="card"><div class="eyebrow">최근 연습</div>${at.length ? at.slice(-15).reverse().map(a => `<div class="hist-item"><div><span class="zh">${esc(a.text)}</span><div class="muted small">${a.date} · 성조 ${a.ok}/${a.n}${a.match != null ? ' · 인식 ' + a.match + '%' : ''}</div></div><button class="btn sm ghost" data-p="${esc(a.text)}">다시</button></div>`).join('') : '<p class="muted small">아직 기록이 없어요.</p>'}</div>
      <div class="card"><div class="eyebrow">설정</div>
        <label class="toggle"><input type="checkbox" id="sstt" ${st.settings.stt ? 'checked' : ''}><span>음성 인식으로 발음 확인 — Chrome이 녹음 소리를 Google 서버로 보내 글자로 바꿔요. 끄면 성조 분석만 해요(성조 분석은 PC 안에서만 계산).</span></label>
        <label class="toggle"><input type="checkbox" id="sauto" ${st.settings.auto ? 'checked' : ''}><span>말이 끝나면 자동으로 녹음 멈추기</span></label>
        <p class="small">목소리 높이 학습: ${Math.min(100, Math.round(Voice.pool().length / 2.5))}% <button class="link" id="vreset">초기화</button> <span class="muted">(목이 쉬었거나 다른 사람이 쓸 때)</span></p>
      </div>`;
    on(el, '[data-p]', b => { if (App.setTarget(b.dataset.p)) App.go('practice'); });
    $('#sstt', el).onchange = e => { st.settings.stt = e.target.checked; Store.save(); };
    $('#sauto', el).onchange = e => { st.settings.auto = e.target.checked; Store.save(); };
    $('#vreset', el).onclick = () => { Voice.reset(); toast('목소리 높이 기록을 지웠어요.'); Views.stats(el); };
  }
};

function buildOptions(intro) {
  if (!window.COURSE) return '';
  const lessons = COURSE.days.filter(d => d.type === 'lesson');
  let html = '';
  if (intro && intro.wrong) {
    const ws = Object.values(intro.wrong).filter(w => !w.resolved && HZ.test(w.label || '')).slice(0, 30);
    if (ws.length) html += `<optgroup label="입문 학습 오답 노트">${ws.map(w => { const zh = (w.speak || w.label).replace(/[^㐀-鿿，。！？]/g, ''); return `<option value="${esc(zh)}">${esc(w.label)}</option>`; }).join('')}</optgroup>`;
  }
  COURSE.weeks.forEach(wk => {
    const ds = lessons.filter(d => d.week === wk.w);
    html += `<optgroup label="${wk.w}주차 문장">${ds.flatMap(d => d.sents.map(s => `<option value="${esc(s[0])}">${d.day}일차 · ${esc(s[0])} (${esc(s[2])})</option>`)).join('')}</optgroup>`;
    html += `<optgroup label="${wk.w}주차 단어">${ds.flatMap(d => d.words.map(w => { const [hz, , ko] = w.split('|'); return `<option value="${esc(hz)}">${esc(hz)} (${esc(ko)})</option>`; })).join('')}</optgroup>`;
  });
  if (window.DRILLS) html += `<optgroup label="성조 짝 연습">${[0, 4, 8, 12, 16, 20, 24, 28, 32].map(i => { const g = DRILLS.tones.slice(i, i + 4).map(x => x[0]).join(''); return `<option value="${g}">${g}</option>`; }).join('')}</optgroup>`;
  return html;
}

// ───── 녹음 → 분석 ─────
async function recordAndAnalyze(el) {
  const btn = $('#rec', el), msg = $('#rmsg', el), lvl = $('#lvl', el);
  if (App.busy) return;
  if (Mic.active()) return App._finish && App._finish();
  if (!navigator.mediaDevices || !window.MediaRecorder) return toast('이 브라우저에서는 녹음을 쓸 수 없어요.');
  try {
    await Mic.start(v => { lvl.style.width = (v * 100) + '%'; }, Store.s.settings.auto ? () => finish() : null);
  } catch (e) { return toast('마이크 권한이 필요해요. 주소창 왼쪽 자물쇠 아이콘에서 허용해 주세요.'); }
  App.sttJob = Store.s.settings.stt ? STT.start('zh-CN') : null;
  btn.classList.add('on'); btn.textContent = '■'; msg.textContent = '듣고 있어요… 말이 끝나면 자동으로 멈춰요.';
  let finishing = false;
  async function finish() {
    if (finishing) return; finishing = true;
    App.busy = true;
    btn.classList.remove('on'); btn.textContent = '…'; btn.disabled = true; msg.textContent = '분석 중…'; lvl.style.width = '0';
    const blob = await Mic.stop();
    const job = await STT.stop(App.sttJob); App.sttJob = null;
    try {
      const r = await analyzeRecording(blob, App.target.sylls);
      if (App.lastBlobUrl) URL.revokeObjectURL(App.lastBlobUrl);
      App.lastBlobUrl = URL.createObjectURL(blob);
      r.heard = job ? job.text.trim() : null; r.alts = job ? job.alts.flat() : []; r.sttErr = job ? job.err : null;
      grade(r);
      App.result = r;
    } catch (e) { console.error(e); App.result = { ok: false, reason: '녹음을 분석하지 못했어요: ' + e.message }; }
    App.busy = false;
    Views.practice(el);
    const rs = $('#result', el); if (rs) rs.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  App._finish = finish;
}

function grade(r) {
  if (!r.ok) return;
  const st = Store.s, t = App.target;
  r.res.forEach(x => {
    if (x.exp === 0) { x.okTone = true; return; }
    x.okTone = x.got === x.exp || (x.alt && x.got === x.alt);
  });
  const graded = r.res.filter(x => x.exp !== 0);
  r.toneOk = graded.filter(x => x.okTone).length; r.toneN = graded.length;
  // 음성 인식 비교
  if (r.heard != null) {
    const tgt = [...t.text].filter(c => HZ.test(c)).join('');
    const cands = [r.heard, ...r.alts].map(h => [...h].filter(c => HZ.test(c)).join('')).filter(Boolean);
    let best = null; cands.forEach(c => { const a = align(tgt, c); if (!best || a.dist < best.dist) best = Object.assign(a, { text: c }); });
    if (best) { r.align = best; r.match = Math.max(0, Math.round((1 - best.dist / Math.max(tgt.length, 1)) * 100)); }
    else r.match = r.sttErr ? null : 0;
  }
  // 기록 저장
  const tones = r.res.filter(x => x.exp !== 0 && x.got).map(x => ({ hz: x.hz, py: x.py, exp: x.exp, got: x.got, ok: x.okTone }));
  st.attempts.push({ date: today(), text: t.text, n: r.toneN, ok: r.toneOk, match: r.match == null ? null : r.match, tones });
  if (st.attempts.length > 500) st.attempts = st.attempts.slice(-500);
  tones.forEach(x => {
    const c = st.chars[x.hz] || (st.chars[x.hz] = { t: 0, ok: 0, py: x.py });
    c.t++; if (x.ok) c.ok++;
    if (!x.ok) { const k = x.exp + '-' + x.got; st.conf[k] = (st.conf[k] || 0) + 1; }
  });
  Store.save();
  r.res.filter(x => x.exp !== 0 && x.got && !x.okTone && x.conf > 0.25).forEach(x => pushIntroWrong(x));
}

function renderResult(el) {
  const r = App.result, t = App.target;
  if (!r.ok) { el.innerHTML = `<div class="note warn">${esc(r.reason)}</div>`; return; }
  const tips = [];
  r.res.forEach(x => {
    if (x.exp === 0 || x.okTone) return;
    if (!x.got) { tips.push({ c: 'info', h: `<b>${esc(x.hz)}</b> — 소리가 짧거나 작아서 성조를 분석하지 못했어요.` }); return; }
    const sand = x.sandhi ? ` (원래 3성이지만 뒤에 3성이 와서 2성으로 읽어요)` : '';
    tips.push({ c: x.conf < 0.25 ? 'info' : '', h: `<b>${esc(x.hz)} ${esc(x.py)}</b> — ${esc(TIPS[x.exp + '-' + x.got] || '')}${sand}${x.conf < 0.25 ? ' <span class="muted small">(판정이 애매해요)</span>' : ''}` });
  });
  if (r.segCount && r.segCount < t.sylls.length - 1) tips.push({ c: 'info', h: `${t.sylls.length}음절이 ${r.segCount}덩어리로 이어져 들렸어요. 처음엔 한 글자씩 또박또박 말하면 더 정확하게 분석돼요.` });
  if (r.align) r.align.ops.filter(o => o.t === 'sub').slice(0, 3).forEach(o => tips.push({ c: 'info', h: `<b>${esc(o.a)}</b>가 <b>${esc(o.b)}</b>로 인식됐어요. ${esc(diagnose(o.a, o.b))}` }));
  if (!tips.length) tips.push({ c: 'good', h: '성조가 모두 기대한 모양으로 들렸어요! 👏 이번엔 원어민 속도로 이어서 말해 보세요.' });
  const heardHtml = r.align ? r.align.ops.map(o => o.t === 'eq' ? esc(o.a) : o.t === 'sub' ? `<span class="diff">${esc(o.b)}</span>` : o.t === 'ins' ? `<span class="diff">${esc(o.b)}</span>` : `<span class="diff">·</span>`).join('') : '';
  el.innerHTML = `<div class="card">
      <div class="score-line"><div><b>${r.toneOk}/${r.toneN}</b><span>성조 일치</span></div>${r.match != null ? `<div><b>${r.match}%</b><span>글자 인식 일치</span></div>` : ''}</div>
      <ul class="tips">${tips.map(x => `<li class="${x.c}">${x.h}</li>`).join('')}</ul>
      <div class="row center wrap"><button class="btn sm ghost" id="pmine">▶ 내 녹음</button><button class="btn sm ghost" id="pboth">⇄ 원어민 → 내 녹음</button></div>
    </div>
    <div class="card"><div class="eyebrow">음높이 그래프</div>${pitchChart(r.res)}
      <div class="legend-tones"><span><b style="color:var(--good)">━</b> 내 목소리 (맞음)</span><span><b style="color:var(--bad)">━</b> 내 목소리 (다름)</span><span><b class="muted">┅</b> 기대하는 성조 모양</span></div></div>
    ${r.heard != null ? `<div class="card"><div class="eyebrow">음성 인식 결과</div>${r.heard ? `<div class="heard">${heardHtml || esc(r.heard)}</div><p class="muted small">"${esc(r.heard)}"로 들렸어요. 음성 인식은 문맥으로 글자를 고쳐 버리기도 해서, 여기서 맞아도 성조까지 맞았다는 뜻은 아니에요.</p>` : `<p class="muted small">${r.sttErr ? '음성 인식을 쓰지 못했어요 (' + esc(r.sttErr) + '). 인터넷 연결을 확인해 주세요.' : '인식된 말이 없어요.'}</p>`}</div>` : ''}
    <p class="muted small">ℹ 성조 판정은 녹음의 음높이 곡선을 기대 모양과 비교한 참고용 결과예요. 빠르게 이어 말하거나 잡음이 많으면 틀릴 수 있어요.</p>`;
  $('#pmine', el).onclick = () => playUrl(App.lastBlobUrl);
  $('#pboth', el).onclick = async () => { await TTS.speak(t.text, 0.9); await sleep(300); await playUrl(App.lastBlobUrl); };
}

// ───── 번역 ─────
const Trans = {
  inst: {}, pending: {}, progress: {},
  srcLang(text) { if (/[가-힣]/.test(text)) return 'ko'; if (HZ.test(text) && !/[a-zA-Z]{3,}/.test(text)) return 'zh'; return 'en'; },
  usedOnline: false,
  async run(text, onMsg) {
    const src = this.srcLang(text);
    this.usedOnline = false;
    if (src === 'zh') return text;
    // 휴대폰 등 내장 번역이 없는 브라우저는 바로 온라인 번역 사용
    if (!('Translator' in self)) return this.online(text, src, onMsg);
    try { return await this.builtin(text, src, onMsg); }
    catch (e) {
      try { return await this.online(text, src, onMsg); }
      catch (e2) { throw new Error(e.message + ' (온라인 번역도 실패: ' + e2.message + ')'); }
    }
  },
  // 온라인 번역: 문장이 Google 번역(실패하면 MyMemory) 서버로 전송됨
  async online(text, src, onMsg) {
    this.usedOnline = true;
    onMsg('온라인 번역 중…');
    const get = async url => {
      const ac = new AbortController(); const t = setTimeout(() => ac.abort(), 10000);
      try { const r = await fetch(url, { signal: ac.signal }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
      finally { clearTimeout(t); }
    };
    const q = encodeURIComponent(text);
    try {
      const j = await get(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=${src}&tl=zh-CN&dt=t&q=${q}`);
      const out = (j[0] || []).map(x => x[0]).join('');
      if (out) return out;
      throw new Error('빈 결과');
    } catch (e) {
      try {
        const j = await get(`https://api.mymemory.translated.net/get?q=${q}&langpair=${src}|zh-CN`);
        const out = j && j.responseData && j.responseData.translatedText;
        if (out && j.responseStatus == 200) return out;
        throw new Error('번역 결과 없음');
      } catch (e2) {
        throw new Error(navigator.onLine === false ? '인터넷에 연결되어 있지 않아요.' : '온라인 번역 서버에 연결하지 못했어요. 잠시 뒤 다시 해 보세요.');
      }
    }
  },
  async builtin(text, src, onMsg) {
    if (!this.inst[src]) {
      // 같은 모델을 두 번 준비하지 않도록, 진행 중인 준비 작업을 이어서 기다림
      if (!this.pending[src]) {
        const av = await Translator.availability({ sourceLanguage: src, targetLanguage: 'zh' });
        if (av === 'unavailable') throw new Error('이 기기에서는 해당 언어 번역을 쓸 수 없어요.');
        this.progress[src] = av === 'available' ? 1 : null;
        this.pending[src] = Translator.create({
          sourceLanguage: src, targetLanguage: 'zh',
          monitor: m => m.addEventListener('downloadprogress', e => { this.progress[src] = e.loaded; })
        }).then(t => { this.inst[src] = t; return t; }).finally(() => { this.pending[src] = null; });
      }
      const t0 = Date.now();
      const tick = setInterval(() => {
        const sec = Math.round((Date.now() - t0) / 1000), p = this.progress[src];
        const what = p == null ? '번역 모델 내려받기를 기다리는 중' : p < 1 ? `번역 모델 내려받는 중 ${Math.round(p * 100)}%` : '번역 모델 준비 중';
        onMsg(`${what}… (${sec}초, 처음 한 번만)` + (sec >= 60 ? ' — 오래 걸리면 아래 안내를 확인하세요.' : ''));
      }, 500);
      try {
        await Promise.race([this.pending[src] || Promise.resolve(), new Promise((_, rej) => setTimeout(() => rej(new Error('STALL')), 180000))]);
      } catch (e) {
        if (e.message === 'STALL') throw new Error('번역 모델 준비가 3분 넘게 끝나지 않았어요. 인터넷 연결을 확인하고, 이 창을 닫았다 다시 열어 보세요. 그래도 안 되면 Microsoft Edge에서 열어 주세요 (바탕화면 아이콘은 Edge로 열려요).');
        throw new Error('번역 모델을 준비하지 못했어요: ' + e.message);
      } finally { clearInterval(tick); }
    }
    return await this.inst[src].translate(text);
  }
};
async function doTranslate(el) {
  const text = $('#trin', el).value.trim(); if (!text) return toast('번역할 문장을 넣어 주세요.');
  App.trText = text;
  const msg = $('#trmsg', el); msg.textContent = '번역 중…';
  try {
    const zh = (await Trans.run(text, m => { msg.textContent = m; })).trim();
    msg.textContent = Trans.srcLang(text) === 'zh' ? '중국어 문장이라 발음만 보여 줘요.' : (Trans.usedOnline ? '번역 완료(온라인 번역)' : '번역 완료') + ' — 기계 번역이라 어색할 수 있어요.';
    const st = Store.s;
    st.trans = [{ src: text, zh, date: today() }].concat(st.trans.filter(x => x.src !== text)).slice(0, 50); Store.save();
    App.trLast = { src: text, zh };
    showTranslation($('#trout', el), text, zh);
  } catch (e) { msg.textContent = '⚠ ' + e.message; }
}
function showTranslation(el, src, zh) {
  const found = []; const s = [...zh];
  for (let i = 0; i < s.length;) {
    let hit = null; for (let L = 4; L >= 1; L--) { const w = s.slice(i, i + L).join(''); if (WORDS[w]) { hit = w; break; } }
    if (hit) { if (!found.includes(hit)) found.push(hit); i += [...hit].length; } else i++;
  }
  el.innerHTML = `<div class="card">
      <div class="ruby-line">${rubyHtml(zh)}</div>
      <div class="py-line">${pinyinLine(zh)}</div>
      <div class="legend-tones"><span class="t1">1성</span><span class="t2">2성</span><span class="t3">3성</span><span class="t4">4성</span><span class="t0">경성</span></div>
      <div class="row center wrap"><button class="btn sm ghost" data-say="${esc(zh)}">🔊 듣기</button><button class="btn sm ghost" data-say="${esc(zh)}" data-rate="0.6">🐢 천천히</button><button class="btn sm" id="topr">🎙 이 문장 발음 연습</button><button class="btn sm ghost" id="tcopy">복사</button></div>
      <p class="muted small center">${esc(src)}</p>
    </div>
    ${found.length ? `<div class="card"><div class="eyebrow">입문 과정에서 배우는 단어</div><div class="wchips">${found.map(w => `<button class="wchip" data-say="${esc(w)}"><span class="zh">${esc(w)}</span> <span class="py show">${esc(WORDS[w].py)}</span> <span class="muted small">${esc(WORDS[w].ko)} · ${WORDS[w].day}일차</span></button>`).join('')}</div></div>` : ''}`;
  $('#topr', el).onclick = () => { if (App.setTarget(zh)) App.go('practice'); };
  $('#tcopy', el).onclick = () => navigator.clipboard.writeText(zh).then(() => toast('복사했어요.'), () => toast('복사하지 못했어요.'));
}

window.addEventListener('DOMContentLoaded', () => App.init());
