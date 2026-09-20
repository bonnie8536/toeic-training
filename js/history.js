/* 學習記錄:每一次作答的流水帳(hist,雲端同步),按日期分組,
   每筆可展開看題目、四個選項(標出正解與你選的)、解析。
   紀錄本身只存 {m,id,c,ok,t},題目內容在這裡依 id 從題庫查回來。 */
(function () {
  const root = $('#history-root');
  const T = window.TOEIC || {};
  const LD = T.listening || {};

  const MOD = {
    p5: { label: 'Part 5', group: 'drill' },
    p6: { label: 'Part 6', group: 'drill' },
    p7: { label: 'Part 7', group: 'drill' },
    l1: { label: '聽力 P1', group: 'listen' },
    l2: { label: '聽力 P2', group: 'listen' },
    l3: { label: '聽力 P3', group: 'listen' },
    l4: { label: '聽力 P4', group: 'listen' },
    g: { label: '文法', group: 'grammar' },
    r: { label: '文章題', group: 'read' },
    tq: { label: '單字考題', group: 'read' },
    ph: { label: '片語', group: 'vocab' },
    vq: { label: '單字遊戲', group: 'vocab' },
  };
  const GROUPS = [['all', '全部'], ['drill', '刷題'], ['listen', '聽力'], ['grammar', '文法'], ['read', '閱讀'], ['vocab', '單字片語']];

  const byId = (list, id) => (list || []).find(x => x.id === id);
  function setQ(list, id) {
    const [sid, num] = String(id).split(':');
    const set = byId(list, sid);
    if (!set) return null;
    const q = set.questions.find((x, i) => String(x.num !== undefined ? x.num : i) === num);
    return q ? { set, q } : null;
  }

  /* 把一筆紀錄解析成 {stem, options, answer, explanation, extra} */
  function resolve(rec) {
    const m = rec.m;
    if (m === 'p5') {
      const q = byId(T.part5, rec.id);
      return q && { stem: q.question, options: q.options, answer: q.answer, explanation: q.explanation, tag: q.category };
    }
    if (m === 'p6') {
      const r = setQ(T.part6, rec.id);
      return r && { stem: '空格 (' + r.q.num + ')' + (r.set.title ? ' · ' + r.set.title : ''), options: r.q.options, answer: r.q.answer, explanation: r.q.explanation };
    }
    if (m === 'p7') {
      const r = setQ(T.part7, rec.id);
      return r && { stem: r.q.q, options: r.q.options, answer: r.q.answer, explanation: r.q.explanation, tag: r.set.title };
    }
    if (m === 'l1' || m === 'l2') {
      const q = byId(LD[m === 'l1' ? 'p1' : 'p2'], rec.id);
      return q && {
        stem: m === 'l1' ? '照片描述題' : (q.question || '應答題'),
        options: q.options, answer: q.answer, explanation: q.explanation, zh: q.transcriptZh,
        photo: m === 'l1' ? 'img/listening/' + q.id + '.jpg' : null, audio: q.id,
      };
    }
    if (m === 'l3' || m === 'l4') {
      const [sid, qi] = String(rec.id).split(':');
      const set = byId(LD[m === 'l3' ? 'p3' : 'p4'], sid);
      const q = set && set.questions[Number(qi)];
      return q && { stem: q.q, options: q.options, answer: q.answer, explanation: q.explanation, audio: set.id };
    }
    if (m === 'g') {
      const [uid, qi] = String(rec.id).split(':');
      const u = byId(T.grammar, uid);
      const q = u && u.quiz[Number(qi)];
      return q && { stem: q.q, options: q.options, answer: q.answer, explanation: q.explanation, tag: u.title, link: 'grammar.html?u=' + u.id };
    }
    if (m === 'r') {
      const [aid, qi] = String(rec.id).split(':');
      const a = byId(T.articles, aid);
      const q = a && a.questions[Number(qi)];
      return q && { stem: q.q, options: q.options, answer: q.answer, explanation: q.explanation, tag: a.title, link: 'reading.html?id=' + a.id };
    }
    if (m === 'tq') {
      const a = byId(T.articles, rec.id);
      return { stem: '單字考題:' + (a ? a.titleZh : rec.id), score: rec.c, n: rec.n, link: a ? 'reading.html?id=' + a.id : null };
    }
    if (m === 'ph') {
      const p = byId(T.phrases, rec.id);
      return p && { stem: p.quiz.q, options: p.quiz.options, answer: p.quiz.answer, explanation: p.quiz.explanation, tag: p.phrase + ' ' + p.zh };
    }
    if (m === 'vq') {
      return { stem: rec.q || rec.id, options: rec.o || null, answer: rec.a, explanation: rec.x !== undefined ? null : null, picked: rec.x, tag: ({ toast: '記憶吐司', pairs: '翻牌配對', mcq: '單字選擇題' })[rec.g] || '單字遊戲' };
    }
    return null;
  }

  function fmtTime(t) {
    const d = new Date(t);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function dayKey(t) {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayLabel(key) {
    const today = dayKey(Date.now()), yest = dayKey(Date.now() - 864e5);
    if (key === today) return '今天 ' + key;
    if (key === yest) return '昨天 ' + key;
    return key;
  }

  let filter = 'all';
  let shown = 150;
  render();

  function render() {
    document.title = '學習記錄|刷刷英文';
    root.innerHTML = '';
    const all = store.get('hist', []).slice().reverse();   // 新的在前
    root.append(h('div', { class: 'page-head' },
      h('h1', null, '學習記錄')));

    if (!all.length) {
      root.append(h('div', { class: 'q-block' }, '還沒有作答紀錄。'),
        h('div', { class: 'drill-nav-btns' }, h('a', { class: 'btn primary', href: 'practice.html' }, '去題庫刷題')));
      return;
    }

    /* 今日與近 7 天摘要 */
    const now = Date.now();
    const sum = (list) => ({ n: list.length, ok: list.filter(r => r.ok).length });
    const today = sum(all.filter(r => dayKey(r.t) === dayKey(now)));
    const week = sum(all.filter(r => now - r.t < 7 * 864e5));
    const pct = s => s.n ? Math.round(s.ok / s.n * 100) + '%' : '—';
    root.append(h('div', { class: 'hist-stats' },
      h('div', { class: 'stat' }, h('b', null, String(today.n)), h('span', null, '今天作答')),
      h('div', { class: 'stat' }, h('b', null, pct(today)), h('span', null, '今天正確率')),
      h('div', { class: 'stat' }, h('b', null, String(week.n)), h('span', null, '近 7 天作答')),
      h('div', { class: 'stat' }, h('b', null, pct(week)), h('span', null, '近 7 天正確率'))));

    /* 篩選 */
    const tabs = h('div', { class: 'hist-tabs' });
    GROUPS.forEach(([k, label]) => {
      tabs.append(h('button', {
        class: 'hist-tab' + (filter === k ? ' on' : ''), type: 'button',
        onclick: () => { filter = k; shown = 150; render(); },
      }, label));
    });
    root.append(tabs);

    const list = all.filter(r => filter === 'all' || (MOD[r.m] || {}).group === filter);
    if (!list.length) {
      root.append(h('div', { class: 'q-block' }, '這個分類還沒有紀錄。'));
      return;
    }

    /* 按日分組 */
    let curDay = null, dayBox = null;
    list.slice(0, shown).forEach(rec => {
      const dk = dayKey(rec.t);
      if (dk !== curDay) {
        curDay = dk;
        dayBox = h('div', { class: 'hist-day' }, h('div', { class: 'hist-day-head' }, dayLabel(dk)));
        root.append(dayBox);
      }
      dayBox.append(row(rec));
    });
    if (list.length > shown) {
      root.append(h('div', { class: 'drill-nav-btns' },
        h('button', { class: 'btn', onclick: () => { shown += 150; render(); } }, '載入更早的紀錄(還有 ' + (list.length - shown) + ' 筆)')));
    }
    root.append(h('div', { style: 'height:30px' }));
  }

  function row(rec) {
    const mod = MOD[rec.m] || { label: rec.m };
    const info = resolve(rec);
    const stem = info ? info.stem : '(這題已從題庫移除)';
    const isScore = info && info.score !== undefined;
    const pickedText = !info ? '' : isScore ? info.score + '/' + info.n
      : info.options ? (rec.c === -1 || rec.c === undefined ? '未作答' : (rec.c >= 0 && info.options[rec.c] !== undefined ? LETTERS[rec.c] : String(info.picked || rec.c)))
      : String(info.picked !== undefined ? info.picked : rec.c);
    const head = h('div', { class: 'hist-row-head', style: info ? null : 'cursor:default' },
      h('span', { class: 'hist-time' }, fmtTime(rec.t)),
      h('span', { class: 'badge cat', style: 'flex:none' }, mod.label),
      h('span', { class: 'hist-stem' }, String(stem).length > 90 ? String(stem).slice(0, 90) + '…' : stem),
      h('span', { class: 'hist-verdict ' + (rec.ok ? 'ok' : 'bad') }, (rec.ok ? '✓ ' : '✗ ') + pickedText));
    const body = h('div', { class: 'hist-row-body', style: 'display:none' });
    const wrap = h('div', { class: 'hist-row' + (rec.ok ? '' : ' wrong') }, head, body);
    if (info) head.addEventListener('click', () => {
      if (body.style.display === 'none') { if (!body.childNodes.length) body.append(detail(rec, info)); body.style.display = ''; }
      else body.style.display = 'none';
    });
    return wrap;
  }

  function detail(rec, info) {
    const box = h('div', null);
    if (info.tag) box.append(h('div', { class: 'hist-tag' }, info.tag));
    if (info.photo) box.append(h('div', { class: 'listen-photo', style: 'max-width:420px' }, h('img', { src: info.photo, alt: '聽力照片', onerror: e => e.target.remove() })));
    if (info.audio) {
      let audio = null;
      box.append(h('div', { class: 'player' },
        h('button', {
          class: 'btn player-btn', type: 'button',
          onclick: () => {
            if (audio) audio.pause();
            audio = new Audio('audio/' + info.audio + '.mp3');
            audio.play().catch(() => {});
          },
        }, '▶ 重聽')));
    }
    if (info.score !== undefined) {
      box.append(h('p', { class: 'result-note' }, '成績 ' + info.score + '/' + info.n + '。'),
        info.link ? h('a', { class: 'btn', href: info.link }, '再做一次') : null);
      return box;
    }
    box.append(h('div', { class: 'q-text', style: 'white-space:pre-line' }, info.stem));
    if (info.options) {
      const opts = h('div', { class: 'opts' });
      info.options.forEach((opt, oi) => {
        let cls = 'opt plain';
        if (oi === info.answer) cls = 'opt correct';
        else if (oi === rec.c) cls = 'opt wrong';
        opts.append(h('button', { class: cls, disabled: '' }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      box.append(opts);
    } else if (info.picked !== undefined) {
      box.append(h('p', { class: 'result-note' }, '你的答案:' + info.picked + (rec.ok ? '' : ' · 正解:' + info.answer)));
    }
    if (info.explanation) box.append(h('div', { class: 'explain' }, h('div', null, info.explanation)));
    if (info.zh) box.append(h('div', { class: 'transcript-box' }, h('b', null, '逐字稿'), h('div', { class: 'tr-zh' }, info.zh)));
    if (info.link) box.append(h('div', { class: 'drill-nav-btns' }, h('a', { class: 'btn', href: info.link }, '回到出處')));
    return box;
  }
})();
