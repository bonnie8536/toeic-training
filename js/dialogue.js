/* 對話練習:情境列表(分類篩選)+對話頁。
   對話頁:兩個人左右兩側的對話泡泡,點一句就播那一句的聲音;「播放全部」照順序一路播完;
   虛線的是口語或俚語,點了跳出中文解釋;最下面整理這段用到的口語。
   音檔:audio/dlg/<對話 id>-<句數兩位數>.mp3(兩個角色用不同聲音)。
   聽過哪幾句存在 dlg_heard(鍵:對話 id,值:句子編號陣列),只新增這一個鍵。 */
(function () {
  const root = $('#dialogue-root');
  const dialogues = window.TOEIC_DIALOGUES || [];
  const CATS = ['朋友閒聊', '吃吃喝喝', '購物與服務', '交通與旅行', '校園與職場', '休閒生活'];

  if (!root) return;
  if (!dialogues.length) {
    root.append(h('div', { class: 'q-block', style: 'margin-top:30px' }, '對話資料尚未載入。'));
    return;
  }

  const pad2 = (n) => String(n).padStart(2, '0');
  const audioUrl = (d, i) => 'audio/dlg/' + d.id + '-' + pad2(i + 1) + '.mp3';
  const imageUrl = (d) => d.image || ('img/dialogues/' + d.id + '.jpg');   // 跟閱讀一樣的寫實配圖,載不到就整格拿掉
  const heardOf = (id) => (store.get('dlg_heard', {})[id] || []);
  function markHeard(id, i) {
    const all = store.get('dlg_heard', {});
    const list = all[id] || [];
    if (list.indexOf(i) > -1) return;
    store.set('dlg_heard', Object.assign({}, all, { [id]: list.concat(i).sort((a, b) => a - b) }));
  }
  const slangCount = (d) => d.lines.reduce((n, l) => n + (l.slang || []).length, 0);

  const cur = dialogues.find((d) => d.id === getParam('id'));
  if (cur) renderDialogue(cur);
  else renderList();

  /* ============ 情境列表 ============ */
  function renderList() {
    document.title = '對話練習|刷刷英文';
    let filter = '全部';
    const chips = h('div', { class: 'drill-filters', style: 'margin:14px 0 4px' });
    const listWrap = h('div', { class: 'dlg-list' });
    root.append(h('div', { class: 'page-head' }, h('h1', null, '對話練習')), chips, listWrap);

    ['全部', ...CATS.filter((c) => dialogues.some((d) => d.cat === c))].forEach((name) => {
      chips.append(h('button', {
        class: 'chip' + (name === filter ? ' on' : ''), type: 'button',
        onclick: () => { filter = name; $$('.chip', chips).forEach((c) => c.classList.toggle('on', c.textContent === filter)); draw(); },
      }, name));
    });

    function draw() {
      listWrap.innerHTML = '';
      dialogues.filter((d) => filter === '全部' || d.cat === filter).forEach((d) => {
        const heard = heardOf(d.id).length;
        const thumb = h('div', { class: 'thumb' },
          h('img', { src: imageUrl(d), alt: '', loading: 'lazy', width: '600', height: '400', onerror: (e) => e.target.parentNode.remove() }));
        listWrap.append(h('a', { class: 'dlg-card', href: 'dialogue.html?id=' + d.id }, thumb, h('div', { class: 'body' },
          h('div', { class: 'meta' },
            h('span', { class: 'badge cat' }, d.cat),
            h('span', { class: 'badge ' + levelBadgeClass(d.level) }, d.level)),
          h('div', { class: 'dlg-card-title' }, d.title),
          h('div', { class: 'dlg-card-en' }, d.titleEn),
          h('p', { class: 'dlg-card-scene' }, d.scene),
          h('div', { class: 'progress-note' },
            d.lines.length + ' 句 · 口語 ' + slangCount(d) + ' 個' + (heard ? ' · 聽過 ' + heard + '/' + d.lines.length : '')))));
      });
    }
    draw();
  }

  /* ============ 對話頁 ============ */
  function renderDialogue(d) {
    document.title = d.title + '|刷刷英文';
    let bilingual = false, slow = false, playAll = false, playing = -1;
    const audio = new Audio();
    audio.preload = 'none';

    const head = h('div', { class: 'reader-head' },
      h('div', { class: 'meta' },
        h('a', { href: 'dialogue.html' }, '← 回對話列表'),
        h('span', { class: 'badge cat' }, d.cat),
        h('span', { class: 'badge ' + levelBadgeClass(d.level) }, d.level),
        h('span', null, d.lines.length + ' 句')),
      h('h1', null, d.titleEn),
      h('div', { class: 'zh-title' }, d.title));
    const illust = h('div', { class: 'reader-illust dlg-illust' },
      h('img', { src: imageUrl(d), alt: d.title, width: '1200', height: '800', onerror: (e) => e.target.parentNode.remove() }));
    const scene = h('p', { class: 'dlg-scene' }, d.scene);

    const allBtn = h('button', { class: 'btn primary', type: 'button', onclick: toggleAll }, '播放全部');
    const biBtn = h('button', { class: 'btn', type: 'button', onclick: toggleBilingual, 'aria-pressed': 'false' }, '中文翻譯');
    const slowBtn = h('button', { class: 'btn', type: 'button', onclick: toggleSlow, 'aria-pressed': 'false' }, '慢速');
    const progressEl = h('span', { class: 'vocab-progress' });
    const msgEl = h('span', { class: 'dlg-msg', role: 'status' });
    const toolbar = h('div', { class: 'reader-toolbar' }, allBtn, biBtn, slowBtn,
      h('span', { class: 'toolbar-note' }, '點句子播放，虛線字可以點'), progressEl, msgEl);

    const linesEl = h('div', { class: 'dlg-lines' });
    const bubbles = d.lines.map((l, i) => {
      const sp = d.speakers[l.s] || { name: l.s };
      const enEl = h('div', { class: 'en' }, renderEn(l));
      const zhEl = h('div', { class: 'zh' }, l.zh);
      const bubble = h('div', {
        class: 'dlg-bubble', tabindex: '0', role: 'button', 'aria-label': '播放：' + l.en,
        onclick: () => { playAll = false; play(i); },
        onkeydown: (e) => { if (e.target === bubble && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); playAll = false; play(i); } },
      }, enEl, zhEl);
      linesEl.append(h('div', { class: 'dlg-line ' + (l.s === 'A' ? 'left' : 'right') },
        h('div', { class: 'dlg-who' }, h('span', { class: 'profile-dot dlg-dot', 'aria-hidden': 'true' }, sp.name.slice(0, 1)), sp.name),
        bubble));
      return bubble;
    });

    const glossary = renderGlossary(d);
    root.append(head, illust, scene, toolbar, linesEl, glossary);
    updateProgress();

    /* 英文句子:口語的部分包成可以點的虛線字 */
    function renderEn(l) {
      const items = (l.slang || []).map((s) => ({ s, at: l.en.toLowerCase().indexOf(s.t.toLowerCase()) }))
        .filter((x) => x.at > -1).sort((a, b) => a.at - b.at);
      const out = [];
      let pos = 0;
      items.forEach(({ s, at }) => {
        if (at < pos) return;                     // 重疊的跳過
        if (at > pos) out.push(l.en.slice(pos, at));
        const surface = l.en.slice(at, at + s.t.length);
        const span = h('span', { class: 'vw dlg-sl', tabindex: '0', role: 'button', 'aria-label': surface + '，看意思' }, surface);
        const show = (e) => { e.stopPropagation(); openPop(span, s); };
        span.addEventListener('click', show);
        span.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(e); } });
        out.push(span);
        pos = at + s.t.length;
      });
      if (pos < l.en.length) out.push(l.en.slice(pos));
      return out;
    }

    /* ---------- 播放 ---------- */
    function play(i) {
      if (i < 0 || i >= d.lines.length) { stop(); return; }
      playing = i;
      bubbles.forEach((b, k) => b.classList.toggle('playing', k === i));
      const url = audioUrl(d, i);
      if (!audio.src.endsWith(url)) audio.src = url;
      audio.currentTime = 0;
      audio.playbackRate = slow ? 0.8 : 1;
      msgEl.textContent = '';
      const p = audio.play();
      if (p && p.catch) p.catch(() => { msgEl.textContent = '這句的聲音沒有載入，請檢查網路'; stop(); });
      markHeard(d.id, i);
      updateProgress();
      if (playAll) bubbles[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function stop() {
      playAll = false;
      playing = -1;
      try { audio.pause(); } catch (e) {}
      bubbles.forEach((b) => b.classList.remove('playing'));
      allBtn.textContent = '播放全部';
    }
    audio.addEventListener('ended', () => {
      if (playAll) { if (playing + 1 < d.lines.length) play(playing + 1); else stop(); return; }
      bubbles.forEach((b) => b.classList.remove('playing'));
      playing = -1;
    });
    audio.addEventListener('error', () => {
      if (playing < 0) return;
      msgEl.textContent = '這句的聲音沒有載入，請檢查網路';
      stop();
    });
    function toggleAll() {
      if (playAll) { stop(); return; }
      playAll = true;
      allBtn.textContent = '停止';
      play(playing > -1 ? playing : 0);
    }
    function toggleBilingual() {
      bilingual = !bilingual;
      linesEl.classList.toggle('show-zh', bilingual);
      biBtn.classList.toggle('on', bilingual);
      biBtn.setAttribute('aria-pressed', String(bilingual));
    }
    function toggleSlow() {
      slow = !slow;
      audio.playbackRate = slow ? 0.8 : 1;
      slowBtn.classList.toggle('on', slow);
      slowBtn.setAttribute('aria-pressed', String(slow));
    }
    function updateProgress() {
      progressEl.innerHTML = '';
      progressEl.append('聽過 ', h('b', null, String(heardOf(d.id).length)), '/' + d.lines.length + ' 句');
    }
    window.addEventListener('pagehide', () => { try { audio.pause(); } catch (e) {} });
  }

  /* 最下面:這段對話用到的口語(同一個說法只列一次) */
  function renderGlossary(d) {
    const seen = new Set();
    const items = [];
    d.lines.forEach((l) => (l.slang || []).forEach((s) => {
      const k = s.t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      items.push(s);
    }));
    if (!items.length) return h('div');
    return h('section', { class: 'dlg-glossary' },
      h('h2', null, '這段對話的口語'),
      h('dl', null, items.flatMap((s) => [
        h('dt', null, s.t),
        h('dd', null, s.m, s.n ? h('span', { class: 'dlg-note' }, s.n) : null),
      ])));
  }

  /* ---------- 口語解釋的浮動卡片(跟閱讀頁同一套樣式) ---------- */
  let popEl = null, popTarget = null;
  function closePop() { if (popEl) { popEl.remove(); popEl = null; popTarget = null; } }
  function openPop(target, s) {
    if (popTarget === target) { closePop(); return; }
    closePop();
    popEl = h('div', { class: 'vocab-pop', role: 'dialog', 'aria-label': s.t },
      h('button', { class: 'pop-close', onclick: closePop, type: 'button', 'aria-label': '關閉' }, '×'),
      h('div', null, h('span', { class: 'pop-word' }, s.t)),
      h('div', { class: 'dlg-pop-m' }, s.m),
      s.n ? h('div', { class: 'dlg-pop-n' }, s.n) : null);
    popEl.addEventListener('click', (e) => e.stopPropagation());
    document.body.append(popEl);
    popTarget = target;
    const r = target.getBoundingClientRect();
    const pw = popEl.offsetWidth, ph = popEl.offsetHeight;
    let left = window.scrollX + r.left;
    const maxLeft = window.scrollX + document.documentElement.clientWidth - pw - 12;
    if (left > maxLeft) left = maxLeft;
    let top = window.scrollY + r.top - ph - 10;
    if (top < window.scrollY + 6) top = window.scrollY + r.bottom + 10;
    popEl.style.left = Math.max(8, left) + 'px';
    popEl.style.top = top + 'px';
  }
  document.addEventListener('click', closePop);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
})();
