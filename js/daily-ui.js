/* 每日練習的畫面:首頁那一區(#daily-home)與 daily.html(#daily-root,?part=d 聽寫、v 單字、g 文法)。
   選題、對答案、記錄都在 js/daily.js;這裡只畫畫面,寫入一律經過 DAILY.record(common.js 的 store 與 logAttempt)。
   題目文字一律用文字節點放進畫面。 */
(function () {
  if (!window.DAILY) return;
  const D = window.DAILY;
  const PART = {};
  D.PARTS.forEach(p => { PART[p.key] = p; });
  const CHECK = "<svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='m5 12 5 5 9-10'/></svg>";

  /* daily.html 的題目屬於哪一天:載入時定好,過了午夜才交的答案也記回這一天。
     首頁那一區每次畫都重算今天(隔天早上從背景叫回來要換成新的一天) */
  const DAY = D.dateOf(Date.now());
  function prog(day) { return D.progress(store.get(D.KEY, null), day || DAY); }
  function label(p) { return p.name + ' ' + p.n + ' ' + p.unit; }

  /* ---------- 三項的清單(首頁與 daily.html 共用) ---------- */
  function list(pr) {
    const ol = h('ol', { class: 'daily-list' });
    D.PARTS.forEach(p => {
      const s = pr[p.key];
      const st = h('span', { class: 'daily-st' });
      if (s.finished) { st.innerHTML = CHECK; st.append(h('span', null, '完成')); }
      else st.textContent = s.done + ' / ' + s.n;
      ol.append(h('li', null,
        h('a', { class: 'daily-row' + (s.finished ? ' is-done' : ''), href: 'daily.html?part=' + p.key },
          h('span', { class: 'daily-name' }, label(p)), st,
          h('span', { class: 'daily-bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.round(s.done / s.n * 100) + '%' })))));
    });
    return ol;
  }
  function doneLine(pr) {
    return h('p', { class: 'daily-done', hidden: pr.complete ? null : '' }, '今天的三項都做完了，明天換新題。');
  }
  /* 做完以後題數就不重講,只留完成那一行 */
  function count(pr) {
    return h('span', { class: 'daily-count', hidden: pr.complete ? '' : null }, '做完 ' + pr.doneParts + ' / ' + D.PARTS.length + ' 項');
  }

  function paintHome(box) {
    const pr = prog(D.dateOf(Date.now()));
    box.classList.toggle('is-complete', pr.complete);
    box.replaceChildren(h('div', { class: 'daily-head' }, h('h2', { id: 'daily-h' }, '每日練習'), count(pr)), list(pr), doneLine(pr));
  }

  const home = document.getElementById('daily-home');
  if (home) {
    paintHome(home);
    /* 從練習頁按上一頁回來(bfcache)、從背景叫回來,都重畫 */
    window.addEventListener('pageshow', e => { if (e.persisted) paintHome(home); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') paintHome(home); });
  }

  const root = document.getElementById('daily-root');
  if (!root) return;

  const T = window.TOEIC || {};
  const items = D.itemsFor(T, DAY);
  const part = getParam('part');
  let onCloud = null;
  if (PART[part]) runPart(part); else overview();
  syncCloud();

  /* 登入的人:把雲端那一份併進來(兩台各做一項時,不會有一項變回沒做)。
     只有真的讀到雲端(ok)才寫,讀不到就照本機的。CLOUD 沒有載入或訪客就不做 */
  function syncCloud() {
    const C = window.CLOUD;
    if (!C || typeof C.readKey !== 'function' || !window.__PROFILE_ID) return;
    C.readKey(D.KEY).then(r => {
      if (!r || !r.ok || !r.found) return;
      const today = D.dateOf(Date.now());
      const local = store.get(D.KEY, null);
      const merged = D.merge(local, r.v, today > DAY ? today : DAY);
      if (JSON.stringify(merged) === JSON.stringify(D.sanitize(local, today > DAY ? today : DAY))) return;
      store.set(D.KEY, merged);
      if (onCloud) onCloud();
    }).catch(() => {});
  }

  /* ---------- daily.html 沒有指定項目:三項清單 ---------- */
  function overview() {
    document.title = '每日練習|刷刷英文';
    const pr = prog();
    root.replaceChildren(
      h('div', { class: 'page-head' }, h('h1', null, '每日練習'), pr.complete ? null : h('p', null, '做完 ' + pr.doneParts + ' / ' + D.PARTS.length + ' 項')),
      h('section', { class: 'daily-card' + (pr.complete ? ' is-complete' : ''), 'aria-label': '今天的三項' }, list(pr), doneLine(pr)));
    onCloud = overview;
  }

  /* ---------- 一項 5 題 ---------- */
  function runPart(key) {
    const p = PART[key];
    const list5 = items[key];
    document.title = p.name + '|每日練習';
    let player = null;
    let rate = '1';   // 聽寫選的速度,換句子時沿用
    if (!list5.length) {
      root.replaceChildren(top(), h('div', { class: 'q-block' }, '題目載入失敗，請重新整理頁面。'));
      return;
    }
    const first = prog()[key];
    if (first.finished) { summary(); return; }
    let cur = list5.findIndex(x => first.answered[x.id] === undefined);
    if (cur < 0) { summary(); return; }
    onCloud = refreshNav;
    draw(false);

    function top() {
      return h('div', { class: 'drill-top' },
        h('h1', null, p.name),
        h('a', { href: 'daily.html', style: 'font-size:13.5px;margin-left:auto' }, '← 回每日練習'));
    }
    function nav() {
      const ans = prog()[key].answered;
      const el = h('div', { class: 'q-nav' });
      list5.forEach((x, i) => {
        let cls = i === cur ? 'cur' : '';
        if (ans[x.id] === 1) cls += ' ok';
        if (ans[x.id] === 0) cls += ' ng';
        el.append(h('button', { class: cls.trim(), disabled: '', 'aria-label': '第 ' + (i + 1) + ' 題' }, String(i + 1)));
      });
      return el;
    }
    /* 下一個還沒答的(先往後找,再從頭找,跳過的那句會回來);沒有了回 -1 */
    function nextOpen() {
      const ans = prog()[key].answered;
      const order = list5.map((x, i) => i).filter(i => i > cur).concat(list5.map((x, i) => i).filter(i => i < cur));
      const i = order.find(k => ans[list5[k].id] === undefined);
      return i === undefined ? -1 : i;
    }
    function stop() { if (player) { player.stop(); player = null; } }
    function draw(focus) {
      stop();
      const q = list5[cur];
      const block = key === 'd' ? dictation(q) : key === 'v' ? vocab(q) : grammar(q);
      root.replaceChildren(top(), nav(), block);
      if (!focus) return;
      const f = key === 'd' ? player && player.btn : root.querySelector('.opts .opt');
      if (f) f.focus();
    }
    function go(i) { stop(); cur = i; draw(true); window.scrollTo(0, 0); }
    function nextBtn() {
      const left = nextOpen();
      return h('div', { class: 'drill-nav-btns' },
        h('button', {
          class: 'btn primary', type: 'button',
          onclick: () => { if (left < 0) summary(); else go(left); },
        }, left < 0 ? '看成績' : '下一題 →'));
    }
    function save(q, extra) {
      return D.record(Object.assign({ store, log: logAttempt, now: Date.now(), date: DAY, part: key, item: q }, extra));
    }
    /* 答完一題後把題號列的對錯更新 */
    function refreshNav() { const old = root.querySelector('.q-nav'); if (old) old.replaceWith(nav()); }

    /* --- 聽寫:播放與對答案跟聽力訓練頁一樣 --- */
    function dictation(q) {
      let checked = false;
      const input = h('textarea', { class: 'write-area', style: 'min-height:60px', placeholder: '把聽到的句子打在這裡', maxlength: String(D.TYPED_MAX), autocapitalize: 'off', spellcheck: 'false', 'aria-label': '聽到的句子' });
      const result = h('div', null);
      const checkBtn = h('button', { class: 'btn primary', type: 'button', disabled: '', onclick: check }, '對答案');
      /* 音檔載不到:可以先跳過這句,這句不記錄,做完別句會再回來 */
      const skip = h('div', { class: 'pop-btns', style: 'margin-top:10px', hidden: '' });
      player = makePlayer(q.id, rate, v => { rate = v; }, () => {
        if (checked) return;
        const i = nextOpen();
        skip.replaceChildren(i < 0
          ? h('a', { class: 'btn', href: 'daily.html' }, '回每日練習')
          : h('button', { class: 'btn', type: 'button', onclick: () => go(i) }, '跳過這句'));
        skip.hidden = false;
      });
      const empty = () => !input.value.trim();
      input.addEventListener('input', () => { if (!checked) checkBtn.disabled = empty(); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); check(); } });
      function check() {
        if (checked || empty()) return;
        checked = true;
        checkBtn.disabled = true;
        input.readOnly = true;
        skip.hidden = true;
        const r = save(q, { typed: input.value });
        const c = r.result || D.checkDictation(q.text, input.value);
        refreshNav();
        result.append(
          h('div', { class: 'explain' },
            h('div', { class: 'verdict ' + (c.perfect ? 'ok' : 'bad') }, c.perfect ? '完全正確' : '對了 ' + c.hits + ' / ' + c.words + ' 個字'),
            h('div', { class: 'dict-diff' }, c.diff.map(x => h('span', { class: 'dict-word ' + (x.hit ? 'hit' : 'miss') }, x.w))),
            q.note ? h('div', { class: 'tr' }, q.note) : null,
            h('div', { class: 'tr' }, q.zh)),
          nextBtn());
      }
      return h('div', null,
        h('div', { class: 'q-block' },
          h('div', { class: 'meta', style: 'margin-bottom:8px' }, h('span', { class: 'badge ' + levelBadgeClass(q.level) }, q.level)),
          player.el, skip, input,
          h('div', { class: 'pop-btns', style: 'margin-top:10px' }, checkBtn),
          result));
    }

    /* --- 選擇題(單字、文法共用) --- */
    function choice(q, stemEl, options, answer, after) {
      let done = false;
      const result = h('div', null);
      const opts = h('div', { class: 'opts', style: 'margin-top:10px' });
      options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: 'opt', type: 'button',
          onclick: () => {
            if (done) return;
            done = true;
            const ok = oi === answer;
            save(q, { pick: oi });
            refreshNav();
            [...opts.children].forEach((b, bi) => {
              b.disabled = true;
              b.classList.add(bi === answer ? 'correct' : bi === oi ? 'wrong' : 'plain');
            });
            result.append(h('div', { class: 'explain' },
              h('div', { class: 'verdict ' + (ok ? 'ok' : 'bad') }, ok ? '答對了' : '答錯了，正確答案是 ' + LETTERS[answer]),
              after), nextBtn());
          },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      return h('div', { class: 'q-block' }, stemEl, opts, result);
    }
    function vocab(q) {
      return choice(q, h('div', { class: 'toast-stem' }, q.word), q.options, q.a,
        h('div', null, h('b', null, q.word), ' ', h('span', null, q.zh)));
    }
    /* 課名答完才出現(課名常常就是答案的提示),放成一個回那一課的連結 */
    function grammar(q) {
      return choice(q, h('div', { class: 'q-text' }, q.q), q.options, q.answer,
        h('div', null,
          q.explanation ? h('div', null, q.explanation) : null,
          h('div', { class: 'daily-more' }, h('a', { href: 'grammar.html?u=' + encodeURIComponent(q.unitId) }, '複習這一課'))));
    }

    /* 答錯的那幾題:單字是字加中文,聽寫是原句,文法是填好答案的句子 */
    function missed(ans) {
      const bad = list5.filter(x => ans[x.id] === 0);
      if (!bad.length) return null;
      return h('div', { class: 'vq-list daily-miss' }, bad.map(x => {
        if (key === 'v') return h('div', { class: 'vq-item bad' }, h('b', null, x.word), h('span', null, x.zh), h('i', null, '✗'));
        const text = key === 'd' ? x.text
          : /_{2,}/.test(x.q) ? x.q.replace(/_{2,}/, x.options[x.answer]) : [x.q, h('br'), h('b', null, x.options[x.answer])];
        return h('div', { class: 'vq-item bad' }, h('span', null, text), h('i', null, '✗'));
      }));
    }
    function summary() {
      stop();
      onCloud = null;
      const pr = prog();
      const s = pr[key];
      const next = D.PARTS.find(x => !pr[x.key].finished);
      root.replaceChildren(...[top(),
        h('div', { class: 'report-head', style: 'margin-top:18px' }, h('h2', null, '答對 ' + s.ok + ' / ' + s.done + ' ' + p.unit)),
        missed(s.answered),
        pr.complete ? doneLine(pr) : null,
        h('div', { class: 'drill-nav-btns' },
          next ? h('a', { class: 'btn primary', href: 'daily.html?part=' + next.key }, '接著做' + label(next)) : h('a', { class: 'btn primary', href: 'index.html' }, '回首頁')),
      ].filter(Boolean));
      window.scrollTo(0, 0);
    }
  }

  /* 播放器:跟聽力訓練頁一樣不限次數、顯示次數、可變速;速度由外面記著,換句子時沿用 */
  function makePlayer(id, rate, onRate, onError) {
    const audio = new Audio('audio/' + id + '.mp3');
    audio.playbackRate = Number(rate);
    let plays = 0;
    const note = h('span', { class: 'player-note' });
    const fail = () => { note.textContent = '音檔載入失敗，請重新整理頁面。'; btn.disabled = true; onError(); };
    const btn = h('button', {
      class: 'btn primary player-btn', type: 'button',
      onclick: () => {
        plays++;
        audio.currentTime = 0;
        audio.playbackRate = Number(sel.value);
        audio.play().catch(e => { if (!e || e.name !== 'AbortError') fail(); });
        note.textContent = '已播 ' + plays + ' 次';
        btn.textContent = '▶ 再播一次';
      },
    }, '▶ 播放');
    audio.addEventListener('error', fail);
    const sel = h('select', { class: 'cfg-select speed-sel', 'aria-label': '播放速度' },
      [['0.75', '慢速 0.75x'], ['1', '正常 1x'], ['1.25', '快速 1.25x']].map(([v, t]) => {
        const o = h('option', { value: v }, t);
        if (v === rate) o.selected = true;
        return o;
      }));
    sel.value = rate;
    sel.addEventListener('change', () => { audio.playbackRate = Number(sel.value); onRate(sel.value); });
    return { el: h('div', { class: 'player' }, btn, sel, note), btn, stop: () => audio.pause() };
  }
})();
