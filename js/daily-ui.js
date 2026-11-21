/* 每日練習的畫面:首頁那一區(#daily-home)與 daily.html(#daily-root,?part=d 聽寫、v 單字、g 文法)。
   選題、對答案、記錄都在 js/daily.js;這裡只畫畫面,寫入一律經過 DAILY.record(common.js 的 store 與 logAttempt)。
   題目文字一律用文字節點放進畫面。作答用 js/ui.js 的專心模式與結算卡。 */
(function () {
  if (!window.DAILY) return;
  const D = window.DAILY;
  const PART = {};
  D.PARTS.forEach(p => { PART[p.key] = p; });
  const ICON = { d: 'listening', v: 'vocab', g: 'grammar' };
  const CHECK = "<svg viewBox='0 0 24 24' width='16' height='16' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'><path d='m5 12 5 5 9-10'/></svg>";

  /* daily.html 的題目屬於哪一天:載入時定好,過了午夜才交的答案也記回這一天。
     首頁那一區每次畫都重算今天(隔天早上從背景叫回來要換成新的一天) */
  const DAY = D.dateOf(Date.now());
  function prog(day) { return D.progress(store.get(D.KEY, null), day || DAY); }
  function label(p) { return p.name + ' ' + p.n + ' ' + p.unit; }

  /* 動態放進頁面的圖示與鵜鶘:頁面還在載入時由 js/ui.js 在載入完成那一下統一畫,之後重畫的自己叫 UI.mount(掛過的不重掛) */
  function art(box) {
    if (window.UI && document.readyState !== 'loading') UI.mount(box);
  }

  /* ---------- 三項的清單(首頁與 daily.html 共用) ---------- */
  function list(pr) {
    const ol = h('ol', { class: 'daily-list' });
    D.PARTS.forEach(p => {
      const s = pr[p.key];
      const st = h('span', { class: 'daily-st' });
      if (s.finished) st.innerHTML = CHECK;
      st.append(s.done + ' / ' + s.n);
      ol.append(h('li', null,
        h('a', { class: 'daily-row has-art' + (s.finished ? ' is-done' : ''), href: 'daily.html?part=' + p.key },
          h('canvas', { class: 'daily-art', 'data-doodle': ICON[p.key], 'data-size': '40', 'aria-hidden': 'true' }),
          h('span', { class: 'daily-name' }, label(p)), st,
          h('span', { class: 'daily-bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.round(s.done / s.n * 100) + '%' })))));
    });
    return ol;
  }
  /* 清單下面:還沒做完是一顆整寬主按鈕(都沒開始「開始」,做到一半「繼續」,連到第一個還沒做完的項目),全做完換成開心的鵜鶘與一行字 */
  function foot(pr) {
    if (pr.complete) {
      return h('div', { class: 'daily-fin' },
        h('canvas', { 'data-mascot': 'happy', 'data-size': '84', 'aria-hidden': 'true' }),
        h('p', null, '今日練習已完成'));
    }
    const next = D.PARTS.find(x => !pr[x.key].finished);
    const started = D.PARTS.some(x => pr[x.key].done > 0);
    return h('a', { class: 'btn primary daily-go', href: 'daily.html?part=' + next.key }, started ? '繼續' : '開始');
  }
  function count(pr) {
    return h('span', { class: 'daily-count' }, pr.doneParts + ' / ' + D.PARTS.length);
  }

  function paintHome(box) {
    const pr = prog(D.dateOf(Date.now()));
    box.classList.toggle('is-done', pr.complete);
    box.replaceChildren(h('div', { class: 'daily-head' }, h('h2', { id: 'daily-h' }, '每日練習'), count(pr)), list(pr), foot(pr));
    art(box);
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

  /* 只有標題給讀屏用的 h1(專心模式與結算卡上沒有頁首) */
  function srTitle(text) { return h('h1', { class: 'daily-sr' }, text); }
  /* 題目拿不到:整頁一個空狀態,出口是重新整理。共用元件沒載到時換成 uiReady 那一塊(重新整理、回首頁) */
  function failView() {
    root.replaceChildren(srTitle('每日練習'), window.UI
      ? UI.empty({ pose: 'sleep', text: '題目載入失敗', action: { label: '重新整理', onClick: () => location.reload() }, links: [{ label: '回首頁', href: 'index.html' }] })
      : h('p', { class: 'daily-sub' }, '題目載入失敗'));
    if (!window.UI) uiReady();
  }

  /* ---------- daily.html 沒有指定項目:同一張卡 ---------- */
  function overview() {
    document.title = '每日練習 - 衝衝英文';
    const pr = prog();
    root.replaceChildren(
      h('div', { class: 'page-head' },
        h('canvas', { class: 'hub-art', 'data-doodle': 'daily', 'data-size': '40', 'aria-hidden': 'true' }),
        h('h1', null, '每日練習'), count(pr)),
      h('section', { class: 'daily-card' + (pr.complete ? ' is-done' : ''), 'aria-label': '今天的三項' }, list(pr), foot(pr)));
    art(root);
    onCloud = overview;
  }

  /* ---------- 一項 5 題 ---------- */
  function runPart(key) {
    const p = PART[key];
    const list5 = items[key];
    document.title = p.name + ' - 每日練習 - 衝衝英文';
    let player = null;
    let rate = '1';   // 聽寫選的速度,換句子時沿用
    let f = null;     // 專心模式(結算前才有)
    if (!list5.length || !window.UI) { failView(); return; }
    const first = prog()[key];
    if (first.finished) { summary(); return; }
    let cur = list5.findIndex(x => first.answered[x.id] === undefined);
    if (cur < 0) { summary(); return; }
    /* 每題一答完就記下來,中途離開不會丟東西,所以關閉不再問確認 */
    f = UI.focus.enter({ total: list5.length, confirmExit: false, onExit: () => { stop(); location.href = 'daily.html'; } });
    onCloud = showProgress;
    draw(false);

    /* 目前第幾題:已答的題數加一(跳過的那句不算) */
    function showProgress() {
      const ans = prog()[key].answered;
      f.progress(Math.min(list5.length, list5.filter(x => ans[x.id] !== undefined).length + 1));
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
      root.replaceChildren(h('div', { class: 'daily-tags' }, h('h1', { class: 'daily-part' }, p.name),
        key === 'd' ? h('span', { class: 'badge ' + levelBadgeClass(q.level) }, q.level) : null), block);
      showProgress();
      if (!focus) return;
      const el = key === 'd' ? player && player.btn : root.querySelector('.opts .opt');
      if (el) el.focus();
    }
    function go(i) { stop(); cur = i; draw(true); window.scrollTo(0, 0); }
    /* 答完一題:底部換成回饋條,右邊是下一題(沒有了就是看成績) */
    function feedback(ok, answer) {
      const left = nextOpen();
      return f.feedback({ ok, answer, next: left < 0 ? '看成績' : '下一題', onNext: () => { if (left < 0) summary(); else go(left); } });
    }
    /* 解析出現後往下捲:只捲到解析底端不被底部列蓋住,而且題幹不捲到作答列底下(解析很長時,下半段讓人自己捲) */
    function reveal(el) {
      const box = el && el.closest ? el.closest('.q-block') : null;
      const stem = box && box.querySelector('.q-text');
      if (!stem || typeof el.getBoundingClientRect !== 'function' || typeof window.scrollBy !== 'function') {
        if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        return;
      }
      const foot = document.querySelector('.quiz-foot');
      const footTop = foot ? foot.getBoundingClientRect().top : window.innerHeight;
      const need = el.getBoundingClientRect().bottom + 12 - footTop;
      /* 題目最上面那一行(題型標籤)不捲到作答列底下:照作答列實際的下緣算,再留 8 */
      const head = box.firstElementChild || stem, bar = document.querySelector('.topbar');
      const room = head.getBoundingClientRect().top - (bar ? bar.getBoundingClientRect().bottom : 52) - 8;
      const by = Math.min(need, room);
      if (by > 0) window.scrollBy({ top: by, behavior: 'smooth' });
    }
    function save(q, extra) {
      return D.record(Object.assign({ store, log: logAttempt, now: Date.now(), date: DAY, part: key, item: q }, extra));
    }
    /* 這一頁沒有 data-gate(訪客也能做每日練習)。已登入、可是因為帳號那一邊存不進去時(別的分頁登出、換帳號,
       或這台的帳號資料夾還沒從雲端灌好):這一下不生效、不對答案,開「重新整理」卡(js/common.js holdForAccount;第 2 輪審查)。
       舊版 common.js 沒有這個函式就照舊 */
    function held(el) { return typeof holdForAccount === 'function' && holdForAccount(el); }

    /* --- 聽寫:播放與對答案跟聽力訓練頁一樣 --- */
    function dictation(q) {
      let checked = false;
      const input = h('textarea', { class: 'write-area', style: 'min-height:60px', placeholder: '輸入聽到的句子', maxlength: String(D.TYPED_MAX), autocapitalize: 'off', spellcheck: 'false', 'aria-label': '聽到的句子' });
      const result = h('div', null);
      const checkBtn = h('button', { class: 'btn primary', type: 'button', disabled: '', onclick: check }, '對答案');
      f.foot([checkBtn]);
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
        if (checked || empty() || held(checkBtn)) return;
        checked = true;
        checkBtn.disabled = true;
        input.readOnly = true;
        skip.hidden = true;
        const r = save(q, { typed: input.value });
        const c = r.result || D.checkDictation(q.text, input.value);
        result.append(h('div', { class: 'explain' },
          c.perfect ? null : h('div', { class: 'verdict bad' }, '對了 ' + c.hits + ' / ' + c.words + ' 個字'),
          h('div', { class: 'dict-diff' }, c.diff.map(x => h('span', { class: 'dict-word ' + (x.hit ? 'hit' : 'miss') }, x.w))),
          q.note ? h('div', { class: 'tr' }, q.note) : null,
          h('div', { class: 'tr' }, q.zh)));
        feedback(c.perfect, null);
        reveal(result);
      }
      return h('div', { class: 'q-block' },
        player.el, skip, input, result);
    }

    /* --- 選擇題(單字、文法共用) --- */
    function choice(q, stemEl, options, answer, after) {
      let done = false;
      const result = h('div', null);
      const opts = h('div', { class: 'opts', style: 'margin-top:10px' });
      f.foot(null);
      options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: 'opt', type: 'button',
          onclick: e => {
            if (done || held(e.currentTarget)) return;
            done = true;
            save(q, { pick: oi });
            [...opts.children].forEach((b, bi) => {
              b.disabled = true;
              b.classList.add(bi === answer ? 'correct' : bi === oi ? 'wrong' : 'plain');
            });
            result.append(h('div', { class: 'explain' }, after));
            feedback(oi === answer, LETTERS[answer] + '. ' + options[answer]);
            reveal(result);
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
    /* 逐題解析:這一項的每一題(題目或單字、正解),答對打勾、答錯打叉 */
    function rows(items, s) {
      return h('div', { class: 'vq-list daily-miss' }, items.map(x => {
        const bad = s.answered[x.id] === 0;
        const cls = 'vq-item' + (bad ? ' bad' : '');
        const mark = h('i', { 'aria-label': bad ? '答錯' : '答對' }, bad ? '✗' : '✓');
        if (key === 'v') return h('div', { class: cls }, h('b', null, x.word), h('span', null, x.zh), mark);
        const text = key === 'd' ? x.text
          : /_{2,}/.test(x.q) ? x.q.replace(/_{2,}/, x.options[x.answer]) : [x.q, h('br'), h('b', null, x.options[x.answer])];
        return h('div', { class: cls }, h('span', null, text), mark);
      }));
    }
    function summary() {
      stop();
      onCloud = null;
      if (f) { f.leave(); f = null; }
      const pr = prog();
      const s = pr[key];
      const next = D.PARTS.find(x => !pr[x.key].finished);
      const bad = list5.filter(x => s.answered[x.id] === 0);
      const card = UI.result({
        score: s.ok, total: s.done, kicker: label(p), flag: pr.complete ? '今日完成' : null,
        /* 三項都做完:沒有下一步要做,不放實色按鈕,回首頁做成文字連結 */
        primary: next ? { label: '接著做' + next.name, href: 'daily.html?part=' + next.key } : null,
        links: next ? [{ label: '回每日練習', href: 'daily.html' }] : [{ label: '回首頁', href: 'index.html' }],
        earnId: 'd',
      });
      const seenItems = list5.filter(x => s.answered[x.id] !== undefined);
      root.replaceChildren(...[srTitle(p.name), card.el, seenItems.length ? UI.detail('逐題解析 ' + seenItems.length + ' 題', [rows(seenItems, s)], { wrong: bad.length }) : null].filter(Boolean));
      window.scrollTo(0, 0);
      card.heading.focus();
      if (window.PET_HOOK) PET_HOOK.done('d', { into: card.reward });
    }
  }

  /* 播放器:跟聽力訓練頁一樣不限次數、顯示次數、可變速;速度由外面記著,換句子時沿用 */
  function makePlayer(id, rate, onRate, onError) {
    const audio = new Audio('audio/' + id + '.mp3');
    audio.playbackRate = Number(rate);
    let plays = 0;
    const note = h('span', { class: 'player-note' });
    const fail = () => {
      note.replaceChildren(h('span', null, '音檔載入失敗'), h('span', { class: 'player-sub' }, '請重新整理頁面'));
      btn.disabled = true;
      onError();
    };
    const btn = h('button', {
      class: 'btn player-btn', type: 'button',
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
