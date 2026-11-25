/* 預估多益分數卡放到頁面上:「我的」頁(js/profile.js 的帳號區與本機學生檔案)、能力分析頁(js/analysis.js)。window.ESTIMATE_CARDS。
   資料一律走 ESTIMATE_STORE(js/estimate-store.js),畫面一律走 ESTIMATE_UI(js/estimate-ui.js);這裡只接兩邊、處理改級與匯入後補紀錄。
   載入順序:js/common.js、js/ui.js、估分的檔(estimate-core、estimate-data、data/item-params.js、estimate-store、estimate-ui)、這個檔,
   再來 js/profile.js、js/analysis.js。補回舊 28 題要 data/diagnostic.js(兩頁都載,兩頁的數字才一樣)。
   · 先用本機資料畫(ESTIMATE_STORE.peek,不寫),雲端準備好後再讀雲端合併、重算(ESTIMATE_STORE.load),畫第二次。
   · 「再做 N 題」連到練習頁:只有用得到練習頁的人(收費畫面沒開,或使用權沒被鎖)才加連結。
     聽力連到題庫頁的聽力練習(practice.html#listen,js/listening.js 的 LISTEN,作答會算進預估);
     listening.html 是「聽力訓練」(js/ear.js),不算進預估,不連那裡。
   · 建議改級(opt.suggest 為真時才有):文字按鈕,有課程進度先確認;按了才改 levels(ONBOARD_DATA.applyEst),來源與理由記 est。
   · 不刪、不蓋作答紀錄與舊檢測結果:寫入只有 ESTIMATE_STORE 自己補的鍵,和按了改級之後的 levels。

   對外的函式:
   · mount(slot, opt) → { repaint() } | null:在 slot(一個空的元素)裡畫卡片。估分的檔沒載到回 null,slot 保持空的。
       opt = { suggest(要不要有建議改級), onLevel(sec, level)(改級寫好之後呼叫),
               solid(檢測按鈕要不要實色,預設 true;頁面上已經有別的實色主按鈕時給 false) }
   · meSlot() → 元素 | null:「我的」頁(帳號區與本機學生檔案)用:一個放卡片的位置,有建議改級、檢測按鈕是描邊按鈕
       (「我的」頁的實色主按鈕留給小雞卡);改級之後重畫「學習設定」那一區。估分的檔沒載到回 null。
   · hasCourse() → boolean:這個學生有沒有課程進度(有課程的 plan、上過任何一堂,或做過課程前測)。
   · practiceLinks() → { L, R } | null
   · writeLevel(sec, level) → 'ok' | 'blocked' | 'failed'
   · afterImport(pid) → View | null:匯入進度檔、還沒換到那個學生之前,替那個學生補一次預估分數用的紀錄。 */
(function (root) {
  'use strict';
  const LESSON_KEY = /^les_t\d{1,2}_\d{2}$/;
  const LEVEL_KEY = { L: 'listening', R: 'reading' };
  const LEVELS = ['entry', 'threshold', 'advanced', 'high'];
  const isPlain = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

  function ready() {
    const S = root.ESTIMATE_STORE, U = root.ESTIMATE_UI;
    return !!(S && U && typeof S.peek === 'function' && typeof U.card === 'function');
  }
  function cloudOn() { const C = root.CLOUD; return !!(C && C.enabled); }

  /* ---------- 課程進度、練習頁連結 ---------- */
  function prefixOf(pid) { return 'tr_' + (pid ? 'u' + pid + '_' : ''); }
  function hasCourse() {
    const pid = root.__PROFILE_ID;
    if (typeof pid !== 'string' || !pid) return false;
    const pre = prefixOf(pid);
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(pre) !== 0) continue;
        const name = k.slice(pre.length);
        if (LESSON_KEY.test(name) || name === 'tests_v1' || name === 'plan') return true;   // plan:跟新用戶設定、檢測頁的判斷一致
      }
    } catch (e) { return false; }
    return false;
  }
  function practiceLinks() {
    const P = root.PAYWALL, C = root.CLOUD;
    if (P && typeof P.enabled === 'function' && P.enabled() && C && C.enabled) {
      try {
        const locked = typeof C.locked === 'function' && C.locked();
        if (P.decide(C.access, { paidUi: true, locked, page: 'paid' })) return null;
      } catch (e) { return null; }
    }
    return { L: 'practice.html#listen', R: 'practice.html' };
  }

  /* ---------- 改級 ---------- */
  function readLevels() {
    try { /* global store:js/common.js */ return store.get('levels', null); } catch (e) { return null; }
  }
  /* 寫入走 ONBOARD_DATA.applyEst(跟新用戶設定、檢測結果頁同一個寫法,寫完讀回);那支沒載到才自己寫 */
  function writeLevel(sec, level) {
    if (!LEVEL_KEY[sec] || LEVELS.indexOf(level) < 0) return 'failed';
    const D = root.ONBOARD_DATA, C = root.ONBOARD_CORE;
    const cur = readLevels();
    if (!isPlain(cur) || LEVELS.indexOf(cur.listening) < 0 || LEVELS.indexOf(cur.reading) < 0) return 'failed';
    const l = sec === 'L' ? level : cur.listening, r = sec === 'R' ? level : cur.reading;
    const source = Object.assign({}, isPlain(cur.source) ? cur.source : {}, { [LEVEL_KEY[sec]]: 'est' });
    if (D && typeof D.applyEst === 'function') return D.applyEst({ listening: l, reading: r, source });
    if (!C || typeof C.newLevels !== 'function') return 'failed';
    try { if (typeof canKeepProgress === 'function' && !canKeepProgress()) return 'blocked'; } catch (e) { return 'blocked'; }
    store.set('levels', C.newLevels(cur, l, r, source, 'est', new Date().toISOString()));
    const back = readLevels();
    return isPlain(back) && back.listening === l && back.reading === r ? 'ok' : 'failed';
  }

  /* ---------- 卡片 ---------- */
  function safe(fn) { try { return fn(); } catch (e) { return null; } }
  function suggestFor(view, opt) {
    if (!opt.suggest || !view || !view.ok || view.mode === 'guest') return [];
    return safe(() => root.ESTIMATE_STORE.suggestions(view, readLevels())) || [];
  }
  function mount(slot, opt) {
    if (!slot || !ready()) return null;
    const o = opt || {}, S = root.ESTIMATE_STORE, U = root.ESTIMATE_UI;
    let view = safe(() => S.peek()), card = null;
    const course = hasCourse();
    function paint() {
      const next = U.card({
        view: view || { ok: false }, testHref: 'placement.html', practice: practiceLinks(), solid: o.solid,
        suggest: suggestFor(view, o), hasCourse: course, onLevel,
      });
      if (card) card.destroy();
      card = next;
      slot.replaceChildren(next.el);
    }
    function onLevel(sec, level) {
      const r = writeLevel(sec, level);
      if (r === 'blocked' && root.PROFILE && typeof PROFILE.askToAct === 'function') PROFILE.askToAct();
      if (r !== 'ok') return;
      paint();
      if (typeof o.onLevel === 'function') o.onLevel(sec, level);
    }
    paint();
    later().then(() => S.load()).then((v) => { if (v) { view = v; paint(); } }, () => { /* 讀不到雲端:留著本機畫的那一張 */ });
    return { repaint: paint };
  }
  /* 改級之後重畫「學習設定」那一區(js/onboard-ui.js),程度那一列跟著換 */
  function relist() {
    const old = root.document.getElementById('learning-settings');
    const next = old && root.ONBOARD_UI ? root.ONBOARD_UI.settingsSection() : null;
    if (old && next) old.replaceWith(next);
  }
  function meSlot() {
    if (!ready()) return null;
    const slot = root.document.createElement('div');
    slot.className = 'me-est';
    return mount(slot, { suggest: true, solid: false, onLevel: relist }) ? slot : null;
  }
  /* 雲端模式等登入狀態與使用權確定之後再讀;本機模式直接讀 */
  function later() {
    if (!cloudOn()) return Promise.resolve();
    const C = root.CLOUD;
    const wait = (p) => Promise.resolve(p).then(() => null, () => null);
    return wait(C.ready).then(() => (root.PAYWALL && typeof PAYWALL.enabled === 'function' && PAYWALL.enabled() ? wait(C.accessReady) : null));
  }

  /* ---------- 匯入進度檔之後 ---------- */
  /* 只讀寫那個學生的鍵(tr_u<pid>_);本機學生檔案不上傳雲端 */
  function storeOf(pid) {
    const pre = prefixOf(pid);
    return {
      get(k, d) { try { const raw = localStorage.getItem(pre + k); return raw === null ? d : JSON.parse(raw); } catch (e) { return d; } },
      set(k, v) { try { localStorage.setItem(pre + k, JSON.stringify(v)); } catch (e) { /* 存不進去:開「我的」頁時再補 */ } },
    };
  }
  function afterImport(pid) {
    if (!ready() || typeof pid !== 'string' || !pid || pid.charAt(0) === 'c') return null;
    return safe(() => root.ESTIMATE_STORE.refresh({ store: storeOf(pid), profile: pid, cloud: null, canWrite: () => true }));
  }

  root.ESTIMATE_CARDS = Object.freeze({ mount, meSlot, hasCourse, practiceLinks, writeLevel, afterImport });
})(window);
