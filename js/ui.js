/* 衝衝英文:共用元件 window.UI
   - UI.art.ensure(names)      需要時才載入 ChickArt、FoodArt、DoodleArt(js/ 底下同層的檔),回傳 Promise,載入失敗也是 resolve
   - UI.chick(canvas, opt)     小雞:看得到才動;離開畫面、分頁到背景、destroy() 時停掉計時器;減少動態時只畫靜止格。
                               happy 只畫靜止格,跳一下由 CSS 做(opt.hop:進場跳一次)。
                               收掉卡片前請呼叫 destroy();忘了呼叫時,畫布被拿出頁面後小雞會自己收掉計時器與監聽
   - UI.focus.enter(opt)       專心模式(作答中):<html> 加 is-quiz,頂端換成作答列,底部固定列放按鈕或回饋條;
                               opt.action { label, onClick } 是作答列右邊的文字按鈕(交卷)
   - UI.result(opt)            結算卡(opt.earnId:這張卡要認的點心事件 id,建議給);UI.detail(title, nodes, opt) 逐題收合;UI.empty(opt) 空狀態
   - UI.confirm(opt)、UI.prompt(opt)  確認與輸入視窗(Promise)
   - UI.doodle(root)           把 canvas[data-doodle] 交給 DoodleArt 畫;頁面載入時對整頁做一次,canvas[data-chick] 也在那時畫上小雞
   不依賴小雞存檔與登入,不讀寫任何瀏覽器端儲存,不用 innerHTML(文字一律 textContent)。圖沒載到時元件照常顯示,只是少了圖。 */
(function () {
  'use strict';
  const doc = document;
  const html = doc.documentElement;
  const NS = 'http://www.w3.org/2000/svg';
  const LOAD_MS = 10000;                       // 圖的程式最多等這麼久,逾時當作沒載到
  const CHICK_RATIO = 280 / 240;               // 小雞畫布的高寬比(ChickArt.metrics)
  const POSE_FALLBACK = { oops: 'idle', read: 'idle' };
  /* 開心的跳躍裡有壓得很扁的格(蹲下 0.7、落地 0.6),放大在結算卡上像圖壞掉:這些姿勢只畫靜止格(正常比例),
     要跳時由 CSS 把整張畫布往上跳一次(.is-hop,壓扁不超過 0.92、以腳底為基準) */
  const STILL_POSES = ['happy'];
  const HOP_MS = 640;
  const ART_FILES = { ChickArt: 'chick-art.js', FoodArt: 'food-art.js', DoodleArt: 'doodle-art.js' };
  const ART_ALIAS = { chick: 'ChickArt', food: 'FoodArt', doodle: 'DoodleArt' };
  const ICON = {
    close: ['M6 6l12 12', 'M18 6 6 18'],
    ok: ['m5 12.5 4.5 4.5L19 7.5'],
    bad: ['M7 7l10 10', 'M17 7 7 17'],
  };
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
  /* 一個出口:有 href 是連結,否則是按鈕 */
  function action(a, cls) {
    const href = safeHref(a.href);
    const n = href ? el('a', { class: cls, href: href }, [a.label]) : el('button', { class: cls, type: 'button' }, [a.label]);
    if (typeof a.onClick === 'function') n.addEventListener('click', function (e) { a.onClick(e); });
    return n;
  }
  function qsa(root, sel) { try { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); } catch (e) { return []; } }
  function attrNum(n, k, d) { const v = Number(n.getAttribute(k)); return v > 0 ? v : d; }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }

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
      function finish() {
        if (done) return;
        done = true;
        if (t) clearTimeout(t);
        resolve(!!window[name]);
      }
      try {
        let s = findScript(ART_FILES[name]);
        if (!s) {
          s = doc.createElement('script');
          s.src = UI.art.base + ART_FILES[name];
          s.async = false;
          (doc.head || doc.body).append(s);
        }
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

  /* ---------- 小雞 ---------- */
  function posesOf() { const A = window.ChickArt; return A && Array.isArray(A.poses) ? A.poses : []; }
  /* 沒有那個姿勢就退回:oops、read 還沒畫好時用 idle */
  function poseOk(p) {
    const list = posesOf();
    if (list.indexOf(p) > -1) return p;
    const f = POSE_FALLBACK[p];
    if (f && list.indexOf(f) > -1) return f;
    return list.indexOf('idle') > -1 || !list.length ? 'idle' : list[0];
  }
  function chick(canvas, opt) {
    const o = Object.assign({ size: 96, pose: 'idle', still: false, hop: false }, opt || {});
    const size = o.size;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.width = size + 'px';
    canvas.style.height = Math.round(size * CHICK_RATIO) + 'px';
    let anim = null, want = o.pose, running = false, alive = true, back = 0, hopT = 0, hopped = false, io = null, watchT = 0, wasIn = false;
    let seen = !('IntersectionObserver' in window);
    /* 畫布放進頁面過、後來被拿掉了(呼叫端換掉卡片卻沒呼叫 destroy):自己收掉計時器與監聽,不握住畫布 */
    function dropped() {
      if (canvas.isConnected === true) { wasIn = true; return false; }
      return wasIn && canvas.isConnected === false;
    }
    /* 會不會動:靜態的小雞(空狀態)、減少動態、只畫靜止格的姿勢(happy)都不開計時器 */
    const canMove = !o.still && !reduced();
    const loops = function () { return canMove && !reduced() && STILL_POSES.indexOf(poseOk(want)) < 0; };
    function calmOf(p) { const A = window.ChickArt; return A && A.calm && typeof A.calm[p] === 'number' ? A.calm[p] : 0; }
    function clearBack() { if (back) { clearTimeout(back); back = 0; } }
    function clearHop() {
      if (hopT) { clearTimeout(hopT); hopT = 0; }
      safe(function () { canvas.classList.remove('is-hop'); });
    }
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
      const A = window.ChickArt;
      if (anim) return true;
      if (!A || typeof A.animate !== 'function') return false;
      anim = safe(function () { return A.animate(canvas, { size: size, fps: 8, pose: poseOk(want), maxDpr: 2, variants: 1 }); }) || null;
      running = !!anim;
      return !!anim;
    }
    function paintStill(p) {
      const q = poseOk(p || want);
      safe(function () { anim.show(calmOf(q), 0, q); });
      running = false;
    }
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
      if (!go) {
        clearBack();
        if (anim && running) safe(function () { anim.stop(); });
        running = false;
        return;
      }
      if (!anim) { make(); return; }
      if (!running) { running = true; safe(function () { anim.setPose(poseOk(want)); }); }
    }
    /* 沒有 IntersectionObserver 的瀏覽器:畫布被拿掉時沒有事件叫醒 sync,每 5 秒看一次還在不在頁面上 */
    function watch() {
      watchT = setTimeout(function () { watchT = 0; if (!alive) return; if (dropped()) destroy(); else watch(); }, 5000);
    }
    /* 停掉計時器與監聽,畫面停在這個姿勢的靜止格(正常比例) */
    function destroy() {
      if (!alive) return;
      clearBack();
      clearHop();
      if (watchT) { clearTimeout(watchT); watchT = 0; }
      if (anim) { safe(function () { anim.stop(); }); paintStill(); }
      alive = false;
      running = false;
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
    if (window.ChickArt) sync();
    else ensure(['ChickArt']).then(sync);
    return {
      setPose: function (p) {
        want = p;
        clearBack();
        if (anim && running && loops()) safe(function () { anim.setPose(poseOk(p)); });
        else sync();
      },
      /* 播一次再回到原本的姿勢;停著、減少動態時不播。happy 不播畫格,改成靜止格加整張跳一次 */
      play: function (p) {
        const A = window.ChickArt;
        if (!alive || !canMove || reduced() || !anim || !A) return false;
        const q = poseOk(p);
        clearBack();
        if (STILL_POSES.indexOf(q) > -1) {
          paintStill(q);
          hop();
          back = setTimeout(function () { back = 0; sync(); }, HOP_MS);
          return true;
        }
        if (!running) return false;
        safe(function () { anim.setPose(q); });
        const frames = (typeof A.holds === 'function' ? A.holds(q) : []).reduce(function (a, b) { return a + b; }, 0) || 8;
        const fps = (A.fps && A.fps[q]) || 8;
        back = setTimeout(function () { back = 0; if (anim && running) safe(function () { anim.setPose(poseOk(want)); }); }, frames * 1000 / fps);
        return true;
      },
      destroy: destroy,
      get pose() { return anim ? anim.pose : poseOk(want); },
      get running() { return running; },
      get alive() { return alive; },
    };
  }

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
    return {
      ready: ready,
      destroy: function () { alive = false; if (handle && typeof handle.stop === 'function') safe(function () { handle.stop(); }); },
    };
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
  function mountChicks(root) {
    qsa(root || doc, 'canvas[data-chick]').forEach(function (cv) {
      if (cv.getAttribute('data-chick-on')) return;
      cv.setAttribute('data-chick-on', '1');
      chick(cv, { size: attrNum(cv, 'data-size', 96), pose: cv.getAttribute('data-chick') || 'idle', still: cv.hasAttribute('data-still') });
    });
  }

  /* ---------- 確認與輸入視窗 ---------- */
  function dialog(kind, opt) {
    const o = opt || {};
    return new Promise(function (resolve) {
      const opener = doc.activeElement;
      const id = uid('dlg');
      const title = el('h2', { class: 'ui-dialog-h', id: id + '-h' }, [o.title || '']);
      const body = o.body ? el('p', { class: 'ui-dialog-body', id: id + '-b' }, [o.body]) : null;
      let input = null, field = null;
      /* 只有一個欄位:標題已經說了要填什麼(「改暱稱」),不再放看得到的欄位標籤;opt.label 當作輸入框的 aria-label */
      if (kind === 'prompt') {
        input = el('input', { class: 'modal-input ui-dialog-input', id: id + '-i', type: 'text', autocomplete: 'off',
          maxlength: o.maxLength > 0 ? o.maxLength : null, 'aria-label': o.label || o.title || null });
        input.value = o.value === undefined || o.value === null ? '' : String(o.value);
        field = el('div', { class: 'ui-dialog-field' }, [input]);
      }
      const cancel = el('button', { class: 'btn-text ui-dialog-cancel', type: 'button' }, [o.cancel || '取消']);
      const ok = el('button', { class: 'btn primary ui-dialog-ok' + (o.danger ? ' is-danger' : ''), type: 'submit' }, [o.ok || '確定']);
      const box = el('form', { class: 'modal ui-dialog', role: kind === 'confirm' ? 'alertdialog' : 'dialog', 'aria-modal': 'true',
        'aria-labelledby': id + '-h', 'aria-describedby': body ? id + '-b' : null, novalidate: true },
        [title, body, field, el('div', { class: 'ui-dialog-actions' }, [cancel, ok])]);
      const mask = el('div', { class: 'modal-mask ui-mask' }, [box]);
      let closed = false;
      const items = function () { return [input, cancel, ok].filter(function (n) { return n && !n.disabled; }); };
      function syncOk() { if (input) ok.disabled = !input.value.trim(); }
      function finish(v) {
        if (closed) return;
        closed = true;
        doc.removeEventListener('keydown', onKey, true);
        doc.removeEventListener('focusin', onFocus, true);
        mask.remove();
        if (opener && typeof opener.focus === 'function' && opener !== doc.body) safe(function () { opener.focus(); });
        resolve(v);
      }
      const no = function () { finish(kind === 'prompt' ? null : false); };
      function onKey(e) {
        /* Esc 只關這個視窗:不往下傳給頁面上其他 Esc 處理(例如關面板、離開作答) */
        if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); if (typeof e.stopPropagation === 'function') e.stopPropagation(); no(); return; }
        if (e.key !== 'Tab') return;
        const f = items();
        if (!f.length) { e.preventDefault(); return; }
        const first = f[0], last = f[f.length - 1], cur = doc.activeElement;
        if (f.indexOf(cur) < 0) { e.preventDefault(); (e.shiftKey ? last : first).focus(); }
        else if (e.shiftKey && cur === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus(); }
      }
      /* 焦點跑到視窗外(點了後面、讀屏跳出去)就拉回來 */
      function onFocus(e) { if (!closed && e.target && !mask.contains(e.target)) { const f = items(); if (f.length) f[0].focus(); } }
      box.addEventListener('submit', function (e) {
        e.preventDefault();
        if (kind !== 'prompt') { finish(true); return; }
        const v = input.value.trim();
        if (v) finish(v);
      });
      cancel.addEventListener('click', no);
      /* 點遮罩取消:按下與放開都在遮罩上才算(在輸入框裡拖選文字、放開在遮罩上不關) */
      let downOnMask = false;
      const onDown = function (e) { downOnMask = e.target === mask; };
      mask.addEventListener('pointerdown', onDown);
      mask.addEventListener('mousedown', onDown);
      mask.addEventListener('click', function (e) { const ok = downOnMask && e.target === mask; downOnMask = false; if (ok) no(); });
      if (input) input.addEventListener('input', syncOk);
      syncOk();
      doc.body.append(mask);
      doc.addEventListener('keydown', onKey, true);
      doc.addEventListener('focusin', onFocus, true);
      /* 起始焦點:輸入框;危險的確認停在取消上(按錯 Enter 不會刪東西);其他停在確定 */
      if (input) { input.focus(); safe(function () { input.select(); }); }
      else (o.danger ? cancel : ok).focus();
    });
  }
  function confirmBox(opt) { return dialog('confirm', opt); }
  function promptBox(opt) { return dialog('prompt', opt); }

  /* ---------- 專心模式 ---------- */
  let active = null;
  function enter(opt) {
    if (active) active.leave();
    const o = Object.assign({ total: 0, confirmExit: true }, opt || {});
    let total = Math.max(0, o.total | 0), cur = 0, isDirty = false, gone = false, ro = null, myConfirm = null;
    html.classList.add('is-quiz');

    const close = el('button', { class: 'quiz-close', type: 'button', 'aria-label': o.closeLabel || '離開' }, [icon('close')]);
    const fill = el('i', { class: 'quiz-fill' });
    const track = el('span', { class: 'quiz-track', role: 'progressbar', 'aria-label': '進度', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': '0' }, [fill]);
    const count = typeof o.onCount === 'function'
      ? el('button', { class: 'quiz-count', type: 'button', 'aria-haspopup': 'dialog' })
      : el('span', { class: 'quiz-count' });
    if (typeof o.onCount === 'function') count.addEventListener('click', function (e) { o.onCount(e); });
    /* 作答列右邊的文字按鈕(交卷才對答案的模式放「交卷」):底部列就只有「上一題」一個文字按鈕 */
    const side = el('span', { class: 'quiz-side' });
    const bar = el('div', { class: 'quiz-bar' }, [close, track, count, side]);
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
    const fb = el('div', { class: 'quiz-fb' }, [mark, shown]);
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

    function syncLeave() {
      const want = o.confirmExit && isDirty && !gone;
      if (want) { myConfirm = o.body || '離開這次練習？'; doc.body.dataset.leaveConfirm = myConfirm; }
      else if (myConfirm !== null) {
        if (doc.body.dataset.leaveConfirm === myConfirm) delete doc.body.dataset.leaveConfirm;
        myConfirm = null;
      }
    }
    function syncFoot() {
      const empty = !slot.firstChild && !foot.classList.contains('is-fb');
      foot.classList.toggle('is-empty', empty);
      html.classList.toggle('has-quiz-foot', !empty && !gone);
    }
    function paint() {
      const r = total > 0 ? Math.min(1, Math.max(0, cur / total)) : 0;
      fill.style.transform = 'scaleX(' + r + ')';
      count.textContent = total > 0 ? cur + ' / ' + total : '';
      track.setAttribute('aria-valuemax', String(total));
      track.setAttribute('aria-valuenow', String(cur));
    }
    function clearFb() {
      foot.classList.remove('is-fb', 'is-ok', 'is-bad');
      mark.replaceChildren();
      shown.textContent = '';
      live.textContent = '';
    }
    function exit() {
      api.leave();
      if (typeof o.onExit === 'function') { o.onExit(); return; }
      if (window.history && history.length > 1) history.back(); else location.href = 'index.html';
    }
    let asking = false;   // 確認視窗開著時再按關閉不再開第二個
    close.addEventListener('click', function () {
      if (!(o.confirmExit && isDirty)) { exit(); return; }
      if (asking) return;
      asking = true;
      confirmBox({ title: '離開這次練習？', body: o.body, ok: '離開', cancel: '繼續作答', danger: true })
        .then(function (yes) { asking = false; if (yes && !gone) exit(); });
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
      /* 交卷才對答案的模式:作答列右邊的「交卷」;最後一題主按鈕變交卷時傳 null 拿掉 */
      action: setAction,
      /* 即時回饋:淡綠底「答對」或淡紅底「答錯 · 正解 …」,右邊一顆跟著回饋顏色的實色按鈕。回傳那顆按鈕 */
      feedback: function (f) {
        if (!f) { api.foot(null); return null; }
        const btn = el('button', { class: 'btn primary quiz-next', type: 'button' }, [f.next || '下一題']);
        if (typeof f.onNext === 'function') btn.addEventListener('click', function (e) { f.onNext(e); });
        const text = f.ok ? '答對' : '答錯' + (f.answer ? ' · 正解 ' + f.answer : '');
        live.textContent = '';
        foot.classList.add('is-fb');
        foot.classList.toggle('is-ok', !!f.ok);
        foot.classList.toggle('is-bad', !f.ok);
        mark.replaceChildren(icon(f.ok ? 'ok' : 'bad'));
        slot.replaceChildren(btn);
        syncFoot();
        shown.textContent = text;
        live.textContent = text;
        safe(function () { btn.focus({ preventScroll: true }); });
        return btn;
      },
      leave: function () {
        if (gone) return;
        gone = true;
        syncLeave();
        html.classList.remove('is-quiz', 'has-quiz-foot');
        safe(function () { html.style.removeProperty('--quiz-foot-h'); });
        if (ro) safe(function () { ro.disconnect(); });
        bar.remove();
        if (host) host.remove();
        foot.remove();
        live.remove();
        if (active === api) active = null;
      },
      get active() { return !gone; },
    };
    paint();
    active = api;
    return api;
  }

  /* ---------- 結算卡 ---------- */
  function result(opt) {
    const o = opt || {};
    const compact = !!o.compact;
    const scored = typeof o.score === 'number' && typeof o.total === 'number' && o.total > 0;
    const ratio = typeof o.ratio === 'number' ? o.ratio : scored ? o.score / o.total : null;
    const pose = o.pose || (ratio === null ? 'idle' : ratio >= 0.8 ? 'happy' : ratio >= 0.5 ? 'idle' : 'oops');
    const id = uid('result');
    const wide = !compact && mq('(min-width: 900px)');
    const cv = el('canvas', { class: 'result-chick' });
    const head = el('h2', { class: 'result-score', id: id + '-h', tabindex: '-1' });
    if (scored) head.append(el('b', null, [String(o.score)]), ' ', el('span', { class: 'result-of' }, ['/ ' + o.total]));
    else head.append(el('b', null, [String(o.big === undefined ? '' : o.big)]), o.unit ? ' ' : null, o.unit ? el('span', { class: 'result-unit' }, [o.unit]) : null);
    if (o.flag) head.append(' ', el('span', { class: 'result-flag' }, [o.flag]));
    const stats = Array.isArray(o.stats) && o.stats.length
      ? el('dl', { class: 'result-stats' }, o.stats.slice(0, 3).map(function (s) {
        return el('div', { class: 'result-stat' }, [el('dt', null, [String(s[0])]), el('dd', null, [String(s[1])])]);
      }))
      : null;
    const reward = el('div', { class: 'result-reward' });
    const links = (o.links || []).filter(Boolean).map(function (l) { return action(l, 'btn-text result-link'); });
    const acts = el('div', { class: 'result-actions' }, [
      o.primary ? action(o.primary, 'btn primary result-go') : null,
      links.length ? el('div', { class: 'result-links' }, links) : null,
    ]);
    const card = el('section', { class: 'result-card' + (compact ? ' is-compact' : ''), 'aria-labelledby': id + '-h' }, [
      cv,
      o.kicker ? el('p', { class: 'result-kicker' }, [o.kicker]) : null,
      head, stats, reward, acts,
      o.note ? el('p', { class: 'result-note' }, [o.note]) : null,
    ]);
    /* happy 進場時整張跳一次(只畫正常比例的靜止格) */
    const c = chick(cv, { size: compact ? 96 : wide ? 160 : 140, pose: pose, hop: true });
    let snack = null, alive = true, took = false;
    /* 這個事件是不是給這張卡的:
       - 給了 earnId(建議):detail.id 要對上
       - 沒給時:掛勾要已經把那一行(.pet-earn)放進這張卡的點心列(PET_HOOK.done(id, { into: card.reward }) 當下就放),
         事件要是掛勾這一次的(detail.source 是 'hook';補寫舊紀錄的 'later'、從既有紀錄補的 'backfill' 不算),
         而且一張卡只認第一個(同一批補寫送出的其他事件不畫進來) */
    function mine(d) {
      if (o.earnId) return d.id === o.earnId;
      if (took) return false;
      if (d.source !== undefined && d.source !== 'hook') return false;
      return !!(reward.querySelector && reward.querySelector('.pet-earn'));
    }
    /* 掛勾寫「+1 西瓜」那一下:左邊畫出那個食物,小雞跳一次。掛勾寫的那行字不動。
       食物圖真的畫上了才加 has-food(沒載到、不認得的食物不留一個空框) */
    function onEarn(e) {
      const d = e && e.detail;
      if (!alive || !d || d.result !== 'got' || typeof d.food !== 'string') return;
      /* 卡片被拿掉了:小雞已經自己收掉(放進頁面過又被拿掉)就連這個監聽一起拿掉 */
      if (card.isConnected === false) { if (!c.alive) api.destroy(); return; }
      if (!mine(d)) return;
      took = true;
      if (snack) { snack.f.destroy(); snack.cv.remove(); snack = null; reward.classList.remove('has-food'); }
      const fc = el('canvas', { class: 'result-food' });
      const s = { cv: fc, f: food(fc, d.food, 56) };
      snack = s;
      reward.prepend(fc);
      c.play('happy');
      s.f.ready.then(function (ok) {
        if (snack !== s || !alive) return;
        if (ok) reward.classList.add('has-food');
        else { fc.remove(); snack = null; }
      });
    }
    window.addEventListener('pet:earn', onEarn);
    const api = {
      el: card,
      reward: reward,
      heading: head,
      pose: pose,
      chick: c,
      destroy: function () {
        alive = false;
        window.removeEventListener('pet:earn', onEarn);
        c.destroy();
        if (snack) snack.f.destroy();
      },
    };
    return api;
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

  /* ---------- 空狀態 ---------- */
  function empty(opt) {
    const o = opt || {};
    const cv = el('canvas', { class: 'ui-empty-art' });
    const box = el('div', { class: 'ui-empty' }, [cv, el('p', { class: 'ui-empty-text' }, [o.text || ''])]);
    if (o.action && o.action.label) box.append(action(o.action, 'btn ui-empty-go'));
    /* 靜態一張:不開計時器、不掛監聽;box.destroy() 給要收掉畫面的呼叫端用(沒呼叫也不會留下東西) */
    const c = chick(cv, { size: 136, pose: o.pose || 'sleep', still: true });
    box.destroy = c.destroy;
    return box;
  }

  function boot() { mountChicks(doc); doodle(doc); }

  const UI = window.UI = {
    art: { ensure: ensure, base: BASE },
    chick: chick,
    focus: { enter: enter, get active() { return active; } },
    result: result,
    detail: detail,
    empty: empty,
    confirm: confirmBox,
    prompt: promptBox,
    doodle: doodle,
  };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
