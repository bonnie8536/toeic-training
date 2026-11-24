/* 衝衝英文:共用元件 window.UI(每個函式的參數寫在它上方)
   - UI.art.ensure(names)  需要時才載入 PelicanArt、ChickArt、FoodArt、DoodleArt(同層的檔),回傳 Promise,載入失敗也是 resolve
   - UI.mascot(canvas, opt)  主角鵜鶘:沒有或載入失敗時退回小雞,兩個都沒有就不畫;UI.chick(canvas, opt) 只畫小雞(寵物)。
     看得到才動,離開畫面、分頁到背景、destroy() 時停;happy 只畫靜止格,跳一下由 CSS 做,
     結算卡上的鵜鶘例外(opt.loopHappy):照 PelicanArt.fps.happy 一直循環播 10 格,不疊 .is-hop。忘了 destroy 時,畫布拿出頁面後自己收掉
   - UI.focus.enter(opt)  專心模式;UI.sheet(opt) 從作答列點開的面板(題號面板)
   - UI.result(opt) 結算卡、UI.rewardRow(opt) 只有點心列、UI.detail(title, nodes, opt) 逐題收合、UI.empty(opt) 空狀態
   - UI.confirm(opt)、UI.prompt(opt)、UI.alert(opt)  確認、輸入、通知視窗(Promise);opt.body 是字串或節點(要分行時給節點)
   - UI.mount(root)  root 底下的 canvas[data-doodle]、[data-mascot]、[data-chick] 都掛上(掛過的不重掛),頁面載入時對整頁做一次;UI.doodle(root) 只畫圖示
   不依賴小雞存檔與登入,不讀寫任何瀏覽器端儲存,不用 innerHTML(文字一律 textContent)。圖沒載到時元件照常顯示,只是少了圖。 */
(function () {
  'use strict';
  const doc = document;
  const html = doc.documentElement;
  const NS = 'http://www.w3.org/2000/svg';
  const LOAD_MS = 10000;                       // 圖的程式最多等這麼久,逾時當作沒載到
  const CHICK_RATIO = 280 / 240;               // 小雞畫布的高寬比(ChickArt.metrics;載入後以 metrics 為準)
  const PELICAN_RATIO = 280 / 300;             // 鵜鶘畫布的高寬比(PelicanArt.metrics;載入後以 metrics 為準)
  const POSE_FALLBACK = { oops: 'idle', read: 'idle', daydream: 'idle' };
  /* 開心的跳躍裡有壓得很扁的格(蹲下 0.7、落地 0.6),放大在結算卡上像圖壞掉:這些姿勢只畫靜止格(正常比例),
     要跳時由 CSS 把整張畫布往上跳一次(.is-hop,壓扁不超過 0.92、以腳底為基準)。
     例外:結算卡上的鵜鶘(opt.loopHappy,見 mascot 的 playsHappy)直接循環播畫格;退回小雞、減少動態、其他地方的 happy 照舊畫靜止格 */
  const STILL_POSES = ['happy'];
  const HOP_MS = 640;
  const KB_PX = 120;                           // 可視高度比視窗少這麼多:當作鍵盤彈出來了
  const DLG_ARM_MS = 400;                      // 視窗打開後這段時間內,滑鼠或手指點到確定不算(連點兩下的第二下)
  const ART_FILES = { PelicanArt: 'pelican-art.js', ChickArt: 'chick-art.js', FoodArt: 'food-art.js', DoodleArt: 'doodle-art.js' };
  const ART_ALIAS = { pelican: 'PelicanArt', chick: 'ChickArt', food: 'FoodArt', doodle: 'DoodleArt' };
  const ICON = { close: ['M6 6l12 12', 'M18 6 6 18'], ok: ['m5 12.5 4.5 4.5L19 7.5'], bad: ['M7 7l10 10', 'M17 7 7 17'] };
  let seq = 0;

  /* ---------- 小工具 ---------- */
  function uid(p) { seq += 1; return 'ui-' + p + '-' + seq; }
  function mq(q) { try { return !!window.matchMedia && window.matchMedia(q).matches; } catch (e) { return false; } }
  function reduced() { return mq('(prefers-reduced-motion: reduce)'); }
  function el(tag, attrs, kids) {
    const n = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') n.className = v;
      else n.setAttribute(k, v === true ? '' : String(v));
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.append(c.nodeType ? c : doc.createTextNode(String(c)));
    });
    return n;
  }
  function icon(name) {
    const s = doc.createElementNS(NS, 'svg');
    [['viewBox', '0 0 24 24'], ['width', '22'], ['height', '22'], ['aria-hidden', 'true'], ['focusable', 'false'], ['fill', 'none'],
      ['stroke', 'currentColor'], ['stroke-width', '2.2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]
      .forEach(function (a) { s.setAttribute(a[0], a[1]); });
    ICON[name].forEach(function (d) { const p = doc.createElementNS(NS, 'path'); p.setAttribute('d', d); s.append(p); });
    return s;
  }
  /* 連結只收相對路徑與 http(s):先拿掉空白與控制字元再看開頭(瀏覽器會把 "java\tscript:" 當成 javascript:) */
  function safeHref(h) {
    if (typeof h !== 'string' || !h) return null;
    const s = h.replace(/[\u0000- \u007f-\u009f]/g, '');
    if (!s) return null;
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return /^https?:/i.test(s) ? h : null;
    return h;
  }
  /* 呼叫端給的屬性(例如 { 'data-gate': '' }):不收事件(on…)、class、style、href、src(連結一律走 safeHref) */
  function setAttrs(n, attrs) {
    if (!attrs || typeof attrs !== 'object') return n;
    Object.keys(attrs).forEach(function (k) {
      const v = attrs[k];
      if (!/^[a-z][\w.:-]*$/i.test(k) || /^(on|class$|style$|href$|src$)/i.test(k)) return;
      if (v === null || v === undefined || v === false) return;
      n.setAttribute(k, v === true ? '' : String(v));
    });
    return n;
  }
  /* 一個出口:有 href 是連結,否則是按鈕;attrs 照設 */
  function action(a, cls) {
    const href = safeHref(a.href);
    const n = href ? el('a', { class: cls, href: href }, [a.label]) : el('button', { class: cls, type: 'button' }, [a.label]);
    setAttrs(n, a.attrs);
    if (typeof a.onClick === 'function') n.addEventListener('click', function (e) { a.onClick(e); });
    return n;
  }
  function qsa(root, sel) { try { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); } catch (e) { return []; } }
  function attrNum(n, k, d) { const v = Number(n.getAttribute(k)); return v > 0 ? v : d; }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function typing(n) {
    if (!n || !n.tagName) return false;
    if (n.isContentEditable === true || n.tagName === 'TEXTAREA') return true;
    return n.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image|hidden)$/i.test(n.type || '');
  }
  /* 視窗與面板共用:Esc 呼叫 onEsc(不往下傳給頁面上其他 Esc 處理,例如關面板、離開作答);Tab 只在 items() 之間轉;
     焦點跑到遮罩外(點了後面、讀屏跳出去)就拉回來;點遮罩(按下與放開都在遮罩上才算,拖選文字放開在遮罩上不關)也是 onEsc。
     回傳拿掉鍵盤與焦點監聽的函式 */
  function holdFocus(mask, items, onEsc) {
    function onKey(e) {
      if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); if (typeof e.stopPropagation === 'function') e.stopPropagation(); onEsc(); return; }
      if (e.key !== 'Tab') return;
      const f = items();
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1], cur = doc.activeElement;
      if (f.indexOf(cur) < 0) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
      else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
    }
    function onFocus(e) { if (e.target && !mask.contains(e.target)) { const f = items(); if (f.length) f[0].focus(); } }
    let downOnMask = false;
    const onDown = function (e) { downOnMask = e.target === mask; };
    mask.addEventListener('pointerdown', onDown);
    mask.addEventListener('mousedown', onDown);
    mask.addEventListener('click', function (e) { const hit = downOnMask && e.target === mask; downOnMask = false; if (hit) onEsc(); });
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('focusin', onFocus, true);
    return function () { doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('focusin', onFocus, true); };
  }

  /* ---------- 圖的程式:要用時才載 ---------- */
  const loading = {};
  function artBase() {
    const s = doc.currentScript && doc.currentScript.getAttribute && doc.currentScript.getAttribute('src');
    return s && /(^|\/)ui\.js(\?.*)?$/.test(s) ? s.replace(/ui\.js(\?.*)?$/, '') : 'js/';
  }
  const BASE = safe(artBase) || 'js/';
  function findScript(file) {
    const list = doc.getElementsByTagName ? doc.getElementsByTagName('script') : [];
    for (let i = 0; i < list.length; i++) {
      const src = list[i].getAttribute && list[i].getAttribute('src');
      if (src && (src === file || src.slice(-file.length - 1) === '/' + file)) return list[i];
    }
    return null;
  }
  function loadOne(name) {
    if (window[name]) return Promise.resolve(true);
    if (!ART_FILES[name]) return Promise.resolve(false);
    if (loading[name]) return loading[name];
    loading[name] = new Promise(function (resolve) {
      let done = false, t = 0;
      function finish() { if (done) return; done = true; if (t) clearTimeout(t); resolve(!!window[name]); }
      try {
        let s = findScript(ART_FILES[name]);
        if (!s) { s = el('script'); s.src = UI.art.base + ART_FILES[name]; s.async = false; (doc.head || doc.body).append(s); }
        s.addEventListener('load', finish);
        s.addEventListener('error', finish);
        t = setTimeout(finish, LOAD_MS);
      } catch (e) { finish(); }
    }).then(function (ok) { if (!ok) delete loading[name]; return ok; });   // 沒載到:下次要用時再試
    return loading[name];
  }
  function ensure(names) {
    const list = [].concat(names || []).map(function (n) { return ART_ALIAS[n] || n; });
    return Promise.all(list.map(function (n) { return loadOne(n).catch(function () { return false; }); }))
      .then(function (r) { const out = {}; list.forEach(function (n, i) { out[n] = r[i]; }); return out; });
  }

  /* ---------- 主角鵜鶘與配角小雞 ----------
     兩隻的介面一樣(animate、poses、calm、holds、fps、metrics)。同一份程式兩種用法:
     kind 'chick':只畫小雞(寵物);kind 'pelican'(預設):先畫鵜鶘,沒有或載入失敗時退回小雞。 */
  function ratioOf(name) {
    const A = window[name], m = A && A.metrics;
    if (m && m.width > 0 && m.height > 0) return m.height / m.width;
    return name === 'PelicanArt' ? PELICAN_RATIO : CHICK_RATIO;
  }
  function posesOf(name) { const A = window[name]; return A && Array.isArray(A.poses) ? A.poses : []; }
  /* 沒有那個姿勢就退回:oops、read 還沒畫好時用 idle */
  function poseOk(name, p) {
    const list = posesOf(name);
    if (list.indexOf(p) > -1) return p;
    const f = POSE_FALLBACK[p];
    if (f && list.indexOf(f) > -1) return f;
    return list.indexOf('idle') > -1 || !list.length ? 'idle' : list[0];
  }
  function mascot(canvas, opt) {
    const o = Object.assign({ size: 96, pose: 'idle', still: false, hop: false, loopHappy: false, kind: 'pelican' }, opt || {});
    const wantPelican = o.kind !== 'chick';
    const chickSize = o.chickSize > 0 ? o.chickSize : o.size;   // 退回小雞時的寬(鵜鶘比較寬,小雞要小一點)
    let fell = false;                                           // 鵜鶘載不到、改用小雞
    function artName() { return wantPelican && !fell ? 'PelicanArt' : 'ChickArt'; }
    function sizeNow() { return artName() === 'ChickArt' && wantPelican ? chickSize : o.size; }
    /* 畫布大小:寬照給的,高照那隻的 metrics 比例算(不變形) */
    function fit() {
      const w = sizeNow();
      canvas.style.width = w + 'px';
      canvas.style.height = Math.round(w * ratioOf(artName())) + 'px';
      safe(function () { canvas.classList.toggle('is-pelican', artName() === 'PelicanArt'); });
    }
    canvas.setAttribute('aria-hidden', 'true');
    fit();
    let anim = null, want = o.pose, running = false, alive = true, back = 0, hopT = 0, hopped = false, io = null, watchT = 0, wasIn = false;
    let seen = !('IntersectionObserver' in window);
    /* 畫布放進頁面過、後來被拿掉了(呼叫端換掉卡片卻沒呼叫 destroy):自己收掉計時器與監聽,不握住畫布 */
    function dropped() { if (canvas.isConnected === true) { wasIn = true; return false; } return wasIn && canvas.isConnected === false; }
    /* 會不會動:靜態的小雞(空狀態)、減少動態、只畫靜止格的姿勢(happy,結算卡上的鵜鶘除外)都不開計時器 */
    const canMove = !o.still && !reduced();
    /* 結算卡(opt.loopHappy)上的鵜鶘:happy 直接循環播畫格(退回小雞時不算,照舊靜止格加 CSS 跳) */
    function playsHappy(q) { return !!o.loopHappy && q === 'happy' && artName() === 'PelicanArt'; }
    const loops = function () { const q = poseOk(artName(), want); return canMove && !reduced() && (STILL_POSES.indexOf(q) < 0 || playsHappy(q)); };
    function calmOf(p) { const A = window[artName()]; return A && A.calm && typeof A.calm[p] === 'number' ? A.calm[p] : 0; }
    function clearBack() { if (back) { clearTimeout(back); back = 0; } }
    function clearHop() { if (hopT) { clearTimeout(hopT); hopT = 0; } safe(function () { canvas.classList.remove('is-hop'); }); }
    /* 整張畫布跳一次(CSS);減少動態時不跳 */
    function hop() {
      if (!alive || !canMove || reduced()) return false;
      clearHop();
      void canvas.offsetWidth;          // 重設動畫:同一個類別拿掉再加回去才會再播一次
      canvas.classList.add('is-hop');
      hopT = setTimeout(function () { hopT = 0; safe(function () { canvas.classList.remove('is-hop'); }); }, HOP_MS);
      return true;
    }
    function make() {
      const A = window[artName()];
      if (anim) return true;
      if (!A || typeof A.animate !== 'function') return false;
      fit();   // 圖載到了:畫布高度改照它自己的 metrics 比例
      anim = safe(function () { return A.animate(canvas, { size: sizeNow(), fps: 8, pose: poseOk(artName(), want), maxDpr: 2, variants: 1 }); }) || null;
      running = !!anim;
      return running;
    }
    function paintStill(p) { const q = poseOk(artName(), p || want); safe(function () { anim.show(calmOf(q), 0, q); }); running = false; }
    function sync() {
      if (!alive) return;
      if (dropped()) { destroy(); return; }
      if (!loops()) {
        if (!make()) return;
        paintStill();
        if (o.hop && !hopped) { hopped = true; hop(); }
        return;
      }
      const go = seen && doc.visibilityState !== 'hidden';
      if (!go) { clearBack(); if (anim && running) safe(function () { anim.stop(); }); running = false; return; }
      if (!anim) { make(); return; }
      if (!running) { running = true; safe(function () { anim.setPose(poseOk(artName(), want)); }); }
    }
    /* 沒有 IntersectionObserver 的瀏覽器:畫布被拿掉時沒有事件叫醒 sync,每 5 秒看一次還在不在頁面上 */
    function watch() { watchT = setTimeout(function () { watchT = 0; if (!alive) return; if (dropped()) destroy(); else watch(); }, 5000); }
    /* 停掉計時器與監聽,畫面停在這個姿勢的靜止格(正常比例) */
    function destroy() {
      if (!alive) return;
      clearBack(); clearHop();
      if (watchT) { clearTimeout(watchT); watchT = 0; }
      if (anim) { safe(function () { anim.stop(); }); paintStill(); }
      alive = false; running = false;
      if (io) safe(function () { io.disconnect(); });
      if (canMove) doc.removeEventListener('visibilitychange', sync);
    }
    /* 會動的小雞才需要知道看不看得到;靜態的不掛任何監聽,不握住畫布 */
    if (canMove) {
      if (!seen) {
        io = safe(function () {
          const ob = new window.IntersectionObserver(function (es) { seen = es[es.length - 1].isIntersecting; sync(); });
          ob.observe(canvas);
          return ob;
        }) || null;
        if (!io) seen = true;
      }
      if (!io) watch();
      doc.addEventListener('visibilitychange', sync);
    }
    /* 載圖:鵜鶘先試,載不到再試小雞(兩個都沒有就不畫,畫布照鵜鶘的大小留著) */
    if (!wantPelican) {
      if (window.ChickArt) sync(); else ensure(['ChickArt']).then(sync);
    } else if (window.PelicanArt) sync();
    else {
      ensure(['PelicanArt']).then(function (got) {
        if (!alive) return;
        if (got.PelicanArt) { sync(); return; }
        ensure(['ChickArt']).then(function (got2) {
          if (!alive) return;
          if (got2.ChickArt) { fell = true; fit(); }
          sync();
        });
      });
    }
    return {
      setPose: function (p) {
        want = p; clearBack();
        if (anim && running && loops()) safe(function () { anim.setPose(poseOk(artName(), p)); }); else sync();
      },
      /* 播一次再回到原本的姿勢;停著、減少動態時不播。happy 不播畫格,改成靜止格加整張跳一次(結算卡上的鵜鶘本來就在循環播 happy:
         現在就是 happy 時什麼都不用做,是別的姿勢時照一般姿勢播一輪再回去) */
      play: function (p) {
        const A = window[artName()];
        if (!alive || !canMove || reduced() || !anim || !A) return false;
        const q = poseOk(artName(), p);
        clearBack();
        if (playsHappy(q)) {
          if (!running) return false;
          if (poseOk(artName(), want) === q) { if (anim.pose !== q) safe(function () { anim.setPose(q); }); return true; }
        } else if (STILL_POSES.indexOf(q) > -1) { paintStill(q); hop(); back = setTimeout(function () { back = 0; sync(); }, HOP_MS); return true; }
        if (!running) return false;
        safe(function () { anim.setPose(q); });
        const frames = (typeof A.holds === 'function' ? A.holds(q) : []).reduce(function (a, b) { return a + b; }, 0) || 8;
        const fps = (A.fps && A.fps[q]) || 8;
        back = setTimeout(function () { back = 0; if (anim && running) safe(function () { anim.setPose(poseOk(artName(), want)); }); }, frames * 1000 / fps);
        return true;
      },
      destroy: destroy,
      get pose() { return anim ? anim.pose : poseOk(artName(), want); },
      get art() { return artName(); }, get running() { return running; }, get alive() { return alive; },
    };
  }

  /* 小雞(寵物):只畫小雞,不退回別的 */
  function chick(canvas, opt) { return mascot(canvas, Object.assign({}, opt || {}, { kind: 'chick' })); }

  /* ---------- 食物(靜態一張) ---------- */
  function food(canvas, id, size) {
    let handle = null, alive = true;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    const ready = ensure(['FoodArt']).then(function () {
      const F = window.FoodArt;
      if (!alive || !F || typeof F.mount !== 'function') return false;
      if (Array.isArray(F.ids) && F.ids.indexOf(id) < 0) return false;
      handle = safe(function () { return F.mount(canvas, id, { size: size, animate: false, stagger: false }); }) || null;
      return !!handle;
    });
    return { ready: ready, destroy: function () { alive = false; if (handle && typeof handle.stop === 'function') safe(function () { handle.stop(); }); } };
  }

  /* ---------- 圖示(DoodleArt) ---------- */
  /* 不認得的圖示 id 標 .is-noart(CSS 藏起來,版面照沒有圖的樣子排),其他照畫;mountAll 遇到不認得的會在畫完其他之後丟錯,這裡接住 */
  function paintDoodles(r, list) {
    const D = window.DoodleArt;
    if (!D || (typeof D.mountAll !== 'function' && typeof D.mount !== 'function')) return false;
    const known = Array.isArray(D.ids) ? D.ids : null;
    list.forEach(function (cv) {
      if (known && known.indexOf(cv.getAttribute('data-doodle')) < 0) cv.classList.add('is-noart');
    });
    if (typeof D.mountAll === 'function') safe(function () { D.mountAll(r); });
    else list.forEach(function (cv) {
      if (cv.classList.contains('is-noart')) return;
      safe(function () {
        D.mount(cv, cv.getAttribute('data-doodle'), { size: attrNum(cv, 'data-size', 64), tone: cv.getAttribute('data-tone') || 'line', ink: cv.getAttribute('data-ink') || undefined });
      });
    });
    html.classList.add('doodle-ready');
    return true;
  }
  function doodle(root) {
    const r = root || doc;
    const list = qsa(r, 'canvas[data-doodle]');
    if (!list.length) return Promise.resolve(false);
    /* 頁面自己先載了 doodle-art.js(建議這樣做):當下就畫,版面不會在圖出現時跳一下 */
    if (window.DoodleArt) return Promise.resolve(paintDoodles(r, list));
    return ensure(['DoodleArt']).then(function () { return paintDoodles(r, list); });
  }
  /* canvas[data-mascot="姿勢"]:主角鵜鶘(首頁首屏等);data-size 是寬,data-still 只畫靜止格 */
  function mountMascots(root) {
    qsa(root || doc, 'canvas[data-mascot]').forEach(function (cv) {
      if (cv.getAttribute('data-mascot-on')) return;
      cv.setAttribute('data-mascot-on', '1');
      const size = attrNum(cv, 'data-size', 180);
      mascot(cv, { size: size, chickSize: Math.round(size * 0.78), pose: cv.getAttribute('data-mascot') || 'idle', still: cv.hasAttribute('data-still') });
    });
  }
  function mountChicks(root) {
    qsa(root || doc, 'canvas[data-chick]').forEach(function (cv) {
      if (cv.getAttribute('data-chick-on')) return;
      cv.setAttribute('data-chick-on', '1');
      chick(cv, { size: attrNum(cv, 'data-size', 96), pose: cv.getAttribute('data-chick') || 'idle', still: cv.hasAttribute('data-still') });
    });
  }
  /* 重畫一個區塊後呼叫:圖示、鵜鶘、小雞都掛上,已經掛過的不重掛。回傳圖示那一份的 Promise */
  function mount(root) {
    const r = root || doc;
    mountMascots(r);
    mountChicks(r);
    return doodle(r);
  }

  /* ---------- 確認、輸入、通知視窗 ---------- */
  /* 同時只開一個視窗:再開一個時先把前一個當取消收掉(兩個都開著時 Esc 會一起關、焦點鎖會互搶) */
  let dlgOpen = null;
  function dialog(kind, opt) {
    const o = opt || {};
    if (dlgOpen) dlgOpen();
    let cancelIt = null;
    const done = new Promise(function (resolve) {
      const opener = doc.activeElement;
      const id = uid('dlg');
      const title = el('h2', { class: 'ui-dialog-h', id: id + '-h' }, [o.title || '']);
      const body = o.body ? el('p', { class: 'ui-dialog-body', id: id + '-b' }, [o.body]) : null;
      let input = null, field = null;
      /* 只有一個欄位:標題已經說了要填什麼(「改暱稱」),不再放看得到的欄位標籤;opt.label 當作輸入框的 aria-label。
         opt.hint 是輸入框下面一行小字(「老師可見」) */
      if (kind === 'prompt') {
        const hint = o.hint ? el('p', { class: 'ui-dialog-hint', id: id + '-n' }, [o.hint]) : null;
        input = el('input', { class: 'modal-input ui-dialog-input', id: id + '-i', type: 'text', autocomplete: 'off',
          maxlength: o.maxLength > 0 ? o.maxLength : null, 'aria-label': o.label || o.title || null, 'aria-describedby': hint ? id + '-n' : null });
        input.value = o.value === undefined || o.value === null ? '' : String(o.value);
        field = el('div', { class: 'ui-dialog-field' }, [input, hint]);
      }
      /* 通知(alert)只有一顆按鈕 */
      const cancel = kind === 'alert' ? null : el('button', { class: 'btn-text ui-dialog-cancel', type: 'button' }, [o.cancel || '取消']);
      const ok = el('button', { class: 'btn primary ui-dialog-ok' + (o.danger ? ' is-danger' : ''), type: 'submit' }, [o.ok || (kind === 'alert' ? '知道了' : '確定')]);
      const box = el('form', { class: 'modal ui-dialog', role: kind === 'prompt' ? 'dialog' : 'alertdialog', 'aria-modal': 'true',
        'aria-labelledby': id + '-h', 'aria-describedby': body ? id + '-b' : null, novalidate: true },
        [title, body, field, el('div', { class: 'ui-dialog-actions' }, [cancel, ok])]);
      const mask = el('div', { class: 'modal-mask ui-mask' }, [box]);
      let closed = false, off = null;
      const items = function () { return [input, cancel, ok].filter(function (n) { return n && !n.disabled; }); };
      function syncOk() { if (input) ok.disabled = !input.value.trim(); }
      function finish(v) {
        if (closed) return;
        closed = true;
        if (dlgOpen === no) dlgOpen = null;
        off();
        mask.remove();
        if (opener && typeof opener.focus === 'function' && opener !== doc.body) safe(function () { opener.focus(); });
        resolve(v);
      }
      /* 取消、Esc、點遮罩:確認回 false、輸入回 null、通知回 true(通知只是看過) */
      const no = function () { finish(kind === 'prompt' ? null : kind === 'alert'); };
      cancelIt = no;
      /* 打開後一小段時間內,滑鼠或手指點到確定不算:前一個視窗的確定與這個視窗的確定位置幾乎一樣,連點兩下時第二下會落在這裡
         (例如刪除帳號的兩層確認)。鍵盤 Enter、程式呼叫的 click 的 detail 是 0,照常 */
      let armed = false;
      setTimeout(function () { armed = true; }, DLG_ARM_MS);
      ok.addEventListener('click', function (e) { if (!armed && e && e.detail > 0) e.preventDefault(); });
      box.addEventListener('submit', function (e) {
        e.preventDefault();
        if (kind !== 'prompt') { finish(true); return; }
        const v = input.value.trim();
        if (v) finish(v);
      });
      if (cancel) cancel.addEventListener('click', no);
      if (input) input.addEventListener('input', syncOk);
      syncOk();
      doc.body.append(mask);
      off = holdFocus(mask, items, no);
      dlgOpen = no;
      /* 起始焦點:輸入框;危險的確認停在取消上(按錯 Enter 不會刪東西);其他停在確定。
         opt.focusCancel:不是危險的動作(確定不用紅色),但按錯 Enter 會蓋掉資料,一樣停在取消上 */
      if (input) { input.focus(); safe(function () { input.select(); }); }
      else ((o.danger || o.focusCancel) && cancel ? cancel : ok).focus();
    });
    /* 打開它的程式要收掉時(例如作答結束)呼叫:等於按取消 */
    done.cancel = function () { if (cancelIt) cancelIt(); };
    return done;
  }
  function confirmBox(opt) { return dialog('confirm', opt); }
  function promptBox(opt) { return dialog('prompt', opt); }
  function alertBox(opt) { return dialog('alert', opt); }

  /* ---------- 面板(從作答列點開:題號面板) ----------
     手機從底部升起,600 以上置中。標題、一行小字(opt.note)、右上「關閉」;內容是 opt.nodes。
     焦點鎖在面板裡、Esc 與點遮罩關閉、關閉後焦點回到打開它的按鈕(close(false) 不回,例如點了題號要換題)。
     起始焦點:opt.focus,沒給時第一個 [aria-current],再沒有就是「關閉」。同時只開一個 */
  let sheetOpen = null, countBtn = null;   // countBtn:從作答列的題號鈕打開時就是它(Safari 點按鈕不給焦點,不能只看 activeElement)
  function sheet(opt) {
    const o = opt || {};
    if (sheetOpen) sheetOpen.close(false);
    const opener = countBtn || doc.activeElement;
    const id = uid('sheet');
    const close = el('button', { class: 'btn-text ui-sheet-close', type: 'button' }, [o.closeLabel || '關閉']);
    const box = el('div', { class: 'modal ui-sheet' + (o.class ? ' ' + o.class : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + '-h' }, [
      el('div', { class: 'ui-sheet-head' }, [el('h2', { class: 'ui-sheet-h', id: id + '-h' }, [o.title || '']), o.note ? el('span', { class: 'ui-sheet-note' }, [o.note]) : null, close]),
      el('div', { class: 'ui-sheet-body' }, [].concat(o.nodes || []).filter(function (n) { return n && n.nodeType; })),
    ]);
    const mask = el('div', { class: 'modal-mask ui-mask ui-sheet-mask' }, [box]);
    let closed = false;
    const items = function () {
      return qsa(box, 'button, a[href], input, select, textarea, [tabindex]').filter(function (n) { return !n.disabled && n.getAttribute('tabindex') !== '-1'; });
    };
    function shut(back) {
      if (closed) return;
      closed = true;
      off();
      mask.remove();
      if (sheetOpen === api) sheetOpen = null;
      if (opener && opener.getAttribute && opener.getAttribute('aria-expanded') === 'true') opener.setAttribute('aria-expanded', 'false');
      if (back !== false && opener && typeof opener.focus === 'function' && opener !== doc.body && opener.isConnected !== false) safe(function () { opener.focus(); });
      if (typeof o.onClose === 'function') safe(function () { o.onClose(); });
    }
    close.addEventListener('click', function () { shut(true); });
    doc.body.append(mask);
    const off = holdFocus(mask, items, function () { shut(true); });
    const api = { el: box, close: shut, get open() { return !closed; } };
    sheetOpen = api;
    if (opener && opener.getAttribute && opener.getAttribute('aria-expanded') === 'false') opener.setAttribute('aria-expanded', 'true');   // 作答列的「題號 3 / 20」
    const first = (o.focus && o.focus.nodeType && box.contains(o.focus) && o.focus) || box.querySelector('[aria-current]') || close;
    safe(function () { first.focus(); });
    return api;
  }

  /* ---------- 專心模式 ---------- */
  let active = null;
  function enter(opt) {
    if (active) active.leave();
    const o = Object.assign({ total: 0, confirmExit: true, dirty: false }, opt || {});
    let total = Math.max(0, o.total | 0), cur = 0, isDirty = !!o.dirty, gone = false, ro = null, myConfirm = null;
    html.classList.add('is-quiz');

    const close = el('button', { class: 'quiz-close', type: 'button', 'aria-label': o.closeLabel || '離開' }, [icon('close')]);
    const fill = el('i', { class: 'quiz-fill' });
    const track = el('span', { class: 'quiz-track', role: 'progressbar', 'aria-label': '進度', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': '0' }, [fill]);
    const count = typeof o.onCount === 'function'
      ? el('button', { class: 'quiz-count', type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' })
      : el('span', { class: 'quiz-count' });
    if (typeof o.onCount === 'function') count.addEventListener('click', function (e) { countBtn = count; try { o.onCount(e); } finally { countBtn = null; } });
    /* 計數左邊的位置(f.slot):模擬考的倒數 */
    const lead = el('span', { class: 'quiz-slot' });
    /* 作答列右邊的文字按鈕(交卷才對答案的模式放「交卷」):底部列就只有「上一題」一個文字按鈕 */
    const side = el('span', { class: 'quiz-side' });
    const bar = el('div', { class: 'quiz-bar' }, [close, track, lead, count, side]);
    function setAction(a) {
      side.replaceChildren(a && a.label ? action(a, 'btn-text quiz-act') : '');
      bar.classList.toggle('has-act', !!(a && a.label));
    }
    setAction(o.action);
    /* 作答列放進頁面原本的頂欄:頂欄在 App 外殼裡會疊在付費牆與登入卡的遮罩上面,關閉鈕一直按得到 */
    const top = doc.querySelector('.topbar');
    const host = top ? null : el('header', { class: 'topbar quiz-host' });
    if (top) top.append(bar);
    else { host.append(bar); doc.body.prepend(host); }

    const mark = el('span', { class: 'quiz-fb-icon', 'aria-hidden': 'true' });
    const shown = el('p', { class: 'quiz-fb-text' });
    const note = el('p', { class: 'quiz-fb-note' });
    const fb = el('div', { class: 'quiz-fb' }, [mark, el('div', { class: 'quiz-fb-words' }, [shown, note])]);
    const slot = el('div', { class: 'quiz-foot-in' });
    const foot = el('div', { class: 'quiz-foot is-empty' }, [el('div', { class: 'quiz-foot-row' }, [fb, slot])]);
    /* 讀屏的播報區:一進專心模式就放好、一直在(視覺上藏起來,不是 display:none)。
       底部列沒有回饋時是 display:none,播報區放在那裡面的話「出現同時寫字」很多讀屏不念 */
    const live = el('p', { class: 'quiz-live', role: 'status' });
    /* 放在 main 後面:Tab 順序是作答列、題目、底部按鈕;鍵盤打開時底部列回到內容後面,不蓋住輸入框 */
    const main = doc.querySelector('main');
    if (main && main.parentNode) main.after(foot); else doc.body.append(foot);
    foot.after(live);
    if ('ResizeObserver' in window) {
      ro = safe(function () {
        const r = new window.ResizeObserver(function () { html.style.setProperty('--quiz-foot-h', foot.offsetHeight + 'px'); });
        r.observe(foot);
        return r;
      }) || null;
    }
    /* 鍵盤彈出(一般網頁;App 外殼自己加 html.app-kb):輸入框聚焦、可視高度少 KB_PX 以上時加 html.ui-kb,
       底部列回到內容後面,不蓋住輸入框。聚焦與鍵盤動畫有先後,焦點換了之後再看一次 */
    const vv = window.visualViewport;
    let kbT = 0;
    function kb() { html.classList.toggle('ui-kb', !gone && typing(doc.activeElement) && (window.innerHeight || 0) - vv.height > KB_PX); }
    function kbLater() { if (kbT) clearTimeout(kbT); kbT = setTimeout(function () { kbT = 0; kb(); }, 300); }
    function kbWatch(on) {
      if (!vv || typeof vv.addEventListener !== 'function') return;
      const m = on ? 'addEventListener' : 'removeEventListener';
      vv[m]('resize', kb); doc[m]('focusin', kbLater); doc[m]('focusout', kbLater);
    }
    kbWatch(true);

    function syncLeave() {
      const want = o.confirmExit && isDirty && !gone;
      if (want) { myConfirm = o.body || '離開這次練習？'; doc.body.dataset.leaveConfirm = myConfirm; }
      else if (myConfirm !== null) {
        if (doc.body.dataset.leaveConfirm === myConfirm) delete doc.body.dataset.leaveConfirm;
        myConfirm = null;
      }
    }
    function choices() { return qsa(doc, 'main .opt, main .letter-big'); }
    function syncFoot() {
      const empty = !slot.firstChild && !foot.classList.contains('is-fb');
      foot.classList.toggle('is-empty', empty);
      html.classList.toggle('has-quiz-foot', !empty && !gone);
    }
    function paint() {
      const r = total > 0 ? Math.min(1, Math.max(0, cur / total)) : 0;
      fill.style.transform = 'scaleX(' + r + ')';
      count.textContent = total > 0 ? cur + ' / ' + total : '';
      if (count.tagName === 'BUTTON') count.setAttribute('aria-label', '題號 ' + count.textContent);   // 讀屏念「題號 3 / 20」,聽得出是開題號面板
      track.setAttribute('aria-valuemax', String(total));
      track.setAttribute('aria-valuenow', String(cur));
    }
    function clearFb() {
      foot.classList.remove('is-fb', 'is-ok', 'is-bad');
      mark.replaceChildren();
      shown.textContent = note.textContent = live.textContent = '';
    }
    function exit() {
      api.leave();
      if (typeof o.onExit === 'function') { o.onExit(); return; }
      if (window.history && history.length > 1) history.back(); else location.href = 'index.html';
    }
    let asking = null;   // 確認視窗開著時再按關閉不再開第二個;結束專心模式時一起收掉
    close.addEventListener('click', function () {
      if (!(o.confirmExit && isDirty)) { exit(); return; }
      if (asking) return;
      asking = confirmBox({ title: '離開這次練習？', body: o.body, ok: '離開', cancel: '繼續作答', danger: true });
      asking.then(function (yes) { asking = null; if (yes && !gone) exit(); });
    });

    const api = {
      bar: bar,
      el: foot,
      progress: function (n) { cur = Math.max(0, n | 0); paint(); },
      setTotal: function (n) { total = Math.max(0, n | 0); paint(); },
      dirty: function (v) { isDirty = v === undefined ? true : !!v; syncLeave(); },
      foot: function (nodes) {
        clearFb();
        slot.replaceChildren.apply(slot, [].concat(nodes || []).filter(Boolean));
        syncFoot();
      },
      /* 鍵盤作答:選了答案整段重畫時,焦點回到同一顆選項(重畫前記住是第幾顆);焦點不在選項上時不動 */
      keep: function (redraw) {
        const before = choices(), i = before.indexOf(doc.activeElement);
        redraw();
        const n = i > -1 ? choices()[i] : null;
        if (n) safe(function () { n.focus({ preventScroll: true }); });
      },
      /* 換題(下一題、上一題、跳題、開始)之後焦點放到新題的題幹,不掉回頁面最上面 */
      focusMain: function () {
        const t = doc.querySelector('main .q-text, main .mock-gap-no, main .q-block');
        if (!t) return;
        if (!t.hasAttribute('tabindex')) t.setAttribute('tabindex', '-1');
        safe(function () { t.focus({ preventScroll: true }); });
      },
      /* 讀屏播一句(「已選 B」) */
      say: function (text) { live.textContent = ''; live.textContent = String(text || ''); },
      /* 計數左邊放一個元素(模擬考的倒數);傳 null 拿掉 */
      slot: function (node) { lead.replaceChildren.apply(lead, node && node.nodeType ? [node] : []); },
      /* 交卷才對答案的模式:作答列右邊的「交卷」;最後一題主按鈕變交卷時傳 null 拿掉 */
      action: setAction,
      /* 即時回饋:淡綠底「答對」或淡紅底「答錯 · 正解 …」,note 是下面一行小字(「已移出錯題本」);
         右邊一顆跟著回饋顏色的實色按鈕。回傳那顆按鈕 */
      feedback: function (f) {
        if (!f) { api.foot(null); return null; }
        const btn = el('button', { class: 'btn primary quiz-next', type: 'button' }, [f.next || '下一題']);
        if (typeof f.onNext === 'function') btn.addEventListener('click', function (e) { f.onNext(e); });
        const text = f.ok ? '答對' : '答錯' + (f.answer ? ' · 正解 ' + f.answer : '');
        const sub = f.note ? String(f.note) : '';
        live.textContent = '';
        foot.classList.add('is-fb');
        foot.classList.toggle('is-ok', !!f.ok);
        foot.classList.toggle('is-bad', !f.ok);
        mark.replaceChildren(icon(f.ok ? 'ok' : 'bad'));
        slot.replaceChildren(btn);
        syncFoot();
        shown.textContent = text;
        note.textContent = sub;
        live.textContent = sub ? text + ' · ' + sub : text;
        safe(function () { btn.focus({ preventScroll: true }); });
        return btn;
      },
      leave: function () {
        if (gone) return;
        gone = true;
        if (asking) asking.cancel();
        syncLeave();
        html.classList.remove('is-quiz', 'has-quiz-foot', 'ui-kb');
        safe(function () { html.style.removeProperty('--quiz-foot-h'); });
        if (ro) safe(function () { ro.disconnect(); });
        kbWatch(false);
        if (kbT) { clearTimeout(kbT); kbT = 0; }
        bar.remove(); foot.remove(); live.remove();
        if (host) host.remove();
        if (active === api) active = null;
      },
      get active() { return !gone; },
    };
    paint();
    if (isDirty) syncLeave();
    active = api;
    return api;
  }

  /* ---------- 點心列:一個 pet:earn 畫在哪一個 ----------
     結算卡與 UI.rewardRow 都登記在這裡,事件來時只挑一個(同一頁兩張卡不互相搶),依序:
     1. 掛勾正在等結果的那一行(.pet-earn.is-wait)在這裡:PET_HOOK.done(id, { into: card.reward }) 這一次放的(最可靠)
     2. 給了 earnId 而且對得上:事件 id 等於它、以「_」加它結尾(特別點心 y_<來源>、w:…_<來源>),或是截到 24 字的特別點心 id
     3. 點心列裡已經有掛勾放的那一行(.pet-earn)
     同一條規則有好幾個時挑最新的。補寫舊紀錄(source 'later')、從既有紀錄補的('backfill')不畫;一個點心列只認第一個 */
  const earners = [];
  function idHit(id, want) {
    if (typeof id !== 'string' || typeof want !== 'string' || !want) return false;
    if (id === want || id.slice(-want.length - 1) === '_' + want) return true;
    const m = /^(?:y|w:[a-z0-9]+)_(.+)$/.exec(id);
    return !!m && id.length === 24 && want.indexOf(m[1]) === 0;
  }
  function onEarnAll(e) {
    const d = e && e.detail;
    if (!d || d.result !== 'got' || typeof d.food !== 'string') return;
    earners.slice().forEach(function (x) { x.sweep(); });
    if (d.source !== undefined && d.source !== 'hook') return;
    const open = earners.filter(function (x) { return x.open(); }).reverse();
    const rules = [function (x) { return x.waiting() && x.hit(d); }, function (x) { return x.waiting(); },
      function (x) { return x.hit(d); }, function (x) { return x.hasLine(); }];
    for (let i = 0; i < rules.length; i++) {
      const x = open.filter(rules[i])[0];
      if (x) { x.take(d); return; }
    }
  }
  /* host:整張卡(或點心列);mc:結算卡的角色(拿到時跳一次;點心列沒有) */
  function snackSlot(host, reward, earnId, mc) {
    let snack = null, alive = true, took = false, seen = false;
    const has = function (sel) { return !!(reward.querySelector && reward.querySelector(sel)); };
    const me = {
      open: function () { return alive && !took && host.isConnected !== false; },
      /* 被拿出頁面了(換畫面卻沒呼叫 destroy):結算卡看角色有沒有自己收掉,點心列看有沒有放進頁面過 */
      sweep: function () {
        if (!alive) return;
        if (host.isConnected === true) { seen = true; return; }
        if (host.isConnected === false && (mc ? !mc.alive : seen)) me.destroy();
      },
      waiting: function () { return has('.pet-earn.is-wait'); },
      hasLine: function () { return has('.pet-earn'); },
      hit: function (d) { return idHit(d.id, earnId); },
      /* 掛勾寫「+1 西瓜」那一下:左邊畫出那個食物,角色跳一次。掛勾寫的那行字不動。
         食物圖真的畫上了才加 has-food(沒載到、不認得的食物不留一個空框) */
      take: function (d) {
        took = true;
        const fc = el('canvas', { class: 'result-food' });
        const s = { cv: fc, f: food(fc, d.food, 56) };
        snack = s;
        reward.prepend(fc);
        if (mc) mc.play('happy');
        s.f.ready.then(function (ok) {
          if (snack !== s || !alive) return;
          if (ok) reward.classList.add('has-food');
          else { fc.remove(); snack = null; }
        });
      },
      destroy: function () {
        if (!alive) return;
        alive = false;
        const i = earners.indexOf(me);
        if (i > -1) earners.splice(i, 1);
        if (!earners.length) window.removeEventListener('pet:earn', onEarnAll);
        if (snack) snack.f.destroy();
      },
    };
    if (!earners.length) window.addEventListener('pet:earn', onEarnAll);
    earners.push(me);
    return me;
  }

  /* ---------- 結算卡 ---------- */
  function result(opt) {
    const o = opt || {};
    const compact = !!o.compact, inline = !o.compact && !!o.inline, small = compact || inline;
    const scored = typeof o.score === 'number' && typeof o.total === 'number' && o.total > 0;
    const ratio = typeof o.ratio === 'number' ? o.ratio : scored ? o.score / o.total : null;
    const pose = o.pose || (ratio === null ? 'idle' : ratio >= 0.8 ? 'happy' : ratio >= 0.5 ? 'idle' : 'oops');
    const id = uid('result');
    const wide = !small && mq('(min-width: 900px)');
    const cv = el('canvas', { class: 'result-chick' });
    /* 標題:分數「8 / 10」,或 big 加單位(沒給單位就只有 big) */
    const head = el('h2', { class: 'result-score', id: id + '-h', tabindex: '-1' }, scored
      ? [el('b', null, [String(o.score)]), ' ', el('span', { class: 'result-of' }, ['/ ' + o.total])]
      : [el('b', null, [String(o.big === undefined || o.big === null ? '' : o.big)]), o.unit ? ' ' : null, o.unit ? el('span', { class: 'result-unit' }, [o.unit]) : null]);
    if (o.flag) head.append(' ', el('span', { class: 'result-flag' }, [o.flag]));
    const stats = Array.isArray(o.stats) && o.stats.length
      ? el('dl', { class: 'result-stats' }, o.stats.slice(0, 3).map(function (s) {
        return el('div', { class: 'result-stat' }, [el('dt', null, [String(s[0])]), el('dd', null, [String(s[1])])]);
      }))
      : null;
    const reward = el('div', { class: 'result-reward' });
    /* links 裡的 null 略過(有答錯才放「看錯題本」這種寫法) */
    const links = (o.links || []).filter(function (l) { return l && l.label; }).map(function (l) { return action(l, 'btn-text result-link'); });
    const acts = el('div', { class: 'result-actions' }, [
      o.primary ? action(o.primary, 'btn primary result-go') : null,
      links.length ? el('div', { class: 'result-links' }, links) : null,
    ]);
    const card = el('section', { class: 'result-card' + (compact ? ' is-compact' : '') + (inline ? ' is-inline' : ''), 'aria-labelledby': id + '-h' }, [
      cv,
      o.kicker ? el('p', { class: 'result-kicker' }, [o.kicker]) : null,
      head, stats, reward, acts,
      o.note ? el('p', { class: 'result-note' }, [o.note]) : null,
    ]);
    /* happy:鵜鶘循環播 10 格(loopHappy),不疊 CSS 跳;退回小雞時進場整張跳一次(只畫正常比例的靜止格) */
    const c = mascot(cv, { size: small ? 120 : wide ? 200 : 180, chickSize: small ? 96 : wide ? 160 : 140, pose: pose, hop: true, loopHappy: true });
    const s = snackSlot(card, reward, o.earnId, c);
    return {
      el: card,
      reward: reward,
      heading: head,
      pose: pose,
      mascot: c,
      chick: c,
      destroy: function () { s.destroy(); c.destroy(); },
    };
  }

  /* 只有點心列(對話、寫作這種不需要分數卡的地方):PET_HOOK.done(id, { into: row.reward })。
     拿到點心時食物圖畫在左邊,規則跟結算卡一樣;沒有字、沒有點心時不佔高度。換畫面前呼叫 destroy() */
  function rewardRow(opt) {
    const o = opt || {};
    const reward = el('div', { class: 'result-reward' });
    const row = el('div', { class: 'ui-reward-row' }, [reward]);
    const s = snackSlot(row, reward, o.earnId, null);
    return { el: row, reward: reward, destroy: s.destroy };
  }

  /* 逐題內容:預設收合,答錯的題數放在標題右邊 */
  function detail(title, nodes, opt) {
    const o = opt || {};
    const list = [].concat(nodes || []).filter(Boolean);
    const wrong = typeof o.wrong === 'number' ? o.wrong
      : list.filter(function (n) { return n.querySelector && n.querySelector('.opt.wrong'); }).length;
    const sum = el('summary', { class: 'result-detail-sum' }, [
      el('span', { class: 'result-detail-t' }, [title]),
      wrong > 0 ? el('span', { class: 'result-detail-bad' }, ['答錯 ' + wrong + ' 題']) : null,
    ]);
    return el('details', { class: 'result-detail' }, [sum, el('div', { class: 'result-detail-body' }, list)]);
  }

  /* ---------- 空狀態 ----------
     角色一張、一行字、一個出口(action;primary: true 是實色)、一排文字連結(links)、下面再放的節點(extra) */
  function empty(opt) {
    const o = opt || {};
    const cv = el('canvas', { class: 'ui-empty-art' });
    const go = o.action && o.action.label ? action(o.action, 'btn ui-empty-go' + (o.action.primary ? ' primary' : '')) : null;
    const links = (o.links || []).filter(function (l) { return l && l.label; }).map(function (l) { return action(l, 'btn-text ui-empty-link'); });
    const extra = [].concat(o.extra || []).filter(function (n) { return n && n.nodeType; });
    const box = el('div', { class: 'ui-empty' }, [cv, el('p', { class: 'ui-empty-text' }, [o.text || '']), go,
      links.length ? el('div', { class: 'ui-empty-links' }, links) : null,
      extra.length ? el('div', { class: 'ui-empty-extra' }, extra) : null]);
    /* 靜態一張:不開計時器、不掛監聽;box.destroy() 給要收掉畫面的呼叫端用(沒呼叫也不會留下東西) */
    const c = mascot(cv, { size: 130, chickSize: 136, pose: o.pose || 'sleep', still: true });
    box.destroy = c.destroy;
    return box;
  }

  function boot() { mount(doc); }

  const UI = window.UI = {
    art: { ensure: ensure, base: BASE },
    mascot: mascot,
    chick: chick,
    focus: { enter: enter, get active() { return active; } },
    sheet: sheet,
    result: result,
    rewardRow: rewardRow,
    detail: detail,
    empty: empty,
    confirm: confirmBox,
    prompt: promptBox,
    alert: alertBox,
    doodle: doodle,
    mount: mount,
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
