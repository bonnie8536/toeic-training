/* 單字訓練:
   ①掉落遊戲——中文往下掉,打出英文消除;字首+字數提示;三條命;
     單字庫=閱讀文章的標記單字(帶級別),片語庫=片語特訓的 120 條;
     漏接的字會記下來,下一場優先出現。
     「練哪些字」可以勾好幾個(文章單字、片語、自己的題庫)一起練,四種玩法共用。
   ②片語特訓——分家族學習(put/take/look...)+填介系詞練習,錯的優先重出。 */
(function () {
  const root = $('#vocab-root');
  const PHRASES = (window.TOEIC && TOEIC.phrases) || [];

  /* ---------- 單字池(取自文章標記單字) ---------- */
  function buildWordPool(levelName) {
    const seen = {};
    const pool = [];
    ((window.TOEIC && TOEIC.articles) || []).forEach(a => {
      if (levelName !== '全部' && !a.level.startsWith(levelName)) return;
      (a.vocab || []).forEach(v => {
        const ans = String(v.base || v.word).toLowerCase().trim();
        if (!ans || ans.length > 16 || seen[ans]) return;
        seen[ans] = true;
        pool.push({ answer: ans, zh: v.zh });
      });
    });
    return pool;
  }

  function buildPhrasePool() {
    return PHRASES.map(p => ({ answer: String(p.phrase).toLowerCase().trim(), zh: p.zh }));
  }

  function hintOf(answer) {
    return answer.split(' ').map(w => w[0] + ' '.repeat(Math.max(0, w.length - 1)).split('').join('') + '_'.repeat(0)).map((seg, i) => {
      const w = answer.split(' ')[i];
      return w[0] + ' _'.repeat(w.length - 1).replace(/ /g, '');
    }).join('  ');
  }
  /* 上面寫法繞,直接重寫:每個字=首字母+底線 */
  function hint(answer) {
    return answer.split(' ').map(w => w[0] + '_'.repeat(Math.max(0, w.length - 1))).join(' ');
  }

  const norm = s => String(s).toLowerCase().trim().replace(/\s+/g, ' ');

  /* 中文答案的可接受寫法:「上傳；上載」拆成多個;括號內容可有可無(（使）滿意=滿意或使滿意);刪節號不用打(對…有興趣=對有興趣)。
     第一個寫法一定是不含括號的,掉落遊戲英翻中的◯提示照它算字數 */
  const zhKey = s => String(s).replace(/[…⋯.．~～\s]/g, '');
  function zhVariants(zh) {
    const s = String(zh);
    const core = s.replace(/[(（][^)）]*[)）]/g, '');
    const full = s.replace(/[()（）]/g, '');
    const out = [];
    [core, full].forEach(t => t.split(/[;；、,，/／「」\s]+/).forEach(x => {
      x = zhKey(x);
      if (/[一-鿿]/.test(x) && out.indexOf(x) < 0) out.push(x);
    }));
    return out.length ? out : [s.trim()];
  }

  /* ---------- 自訂題庫 ----------
     多台裝置同步(同步合併設計 3.6、3.7.4):每次寫入前重新讀本機那一份,用 js/sync-merge.js 的函式改(蓋 _r、_t、_p 戳記),
     不拿畫面打開時讀進來的舊陣列整份寫回(同一台兩個分頁,另一個分頁剛存的文章題庫才不會被蓋掉)。
     刪題庫、刪字先存刪除標記(sync_del,只有雲端帳號才寫)再存題庫:中途被關掉只會多留,不會少。
     頁面沒載到 sync-merge.js(不該發生)時照舊直接改,不蓋戳記。 */
  const SM = window.SYNC_MERGE || null;
  function getBanks() { const b = store.get('vgame_banks', []); return Array.isArray(b) ? b : []; }
  function saveBanks(banks) { store.set('vgame_banks', banks); }
  function bankOf(id) { return getBanks().find(b => b && b.id === id) || null; }
  const cloudAccount = () => String(window.__PROFILE_ID || '').charAt(0) === 'c';
  /* 改一個題庫(沒有就建立):fn 拿到題庫的複本,回改好的;沒改到內容就不存 */
  function editBank(id, fn) {
    const before = getBanks(), now = Date.now();
    let after;
    if (SM) after = SM.editBank(before, id, now, fn);
    else {
      const i = before.findIndex(b => b && b.id === id);
      const next = fn(i >= 0 ? Object.assign({}, before[i], { words: (before[i].words || []).slice() }) : { id, name: '', words: [] });
      after = before.slice();
      if (i >= 0) after[i] = next; else after.push(next);
    }
    if (after !== before) saveBanks(after);
  }
  /* 改一個字:找同一個英文、內容也一樣的那一個(舊資料可能有兩個同樣的英文),找不到就用第一個同樣英文的 */
  function editWord(id, w, patch) {
    editBank(id, b => {
      const words = (b.words || []).slice();
      let i = SM ? words.findIndex(x => x && norm(x.en) === norm(w.en) && SM.wordHash(x) === SM.wordHash(w)) : -1;
      if (i < 0) i = words.findIndex(x => x && norm(x.en) === norm(w.en));
      if (i < 0) return b;
      words[i] = SM ? SM.reviseWord(words[i], patch, Date.now()) : Object.assign({}, words[i], patch);
      return Object.assign({}, b, { words });
    });
  }
  function removeBank(id) {
    if (!SM) { saveBanks(getBanks().filter(x => x.id !== id)); return; }
    const d = SM.deleteBank(getBanks(), store.get('sync_del', null), id, Date.now());
    if (cloudAccount()) store.set('sync_del', d.tombs);
    saveBanks(d.banks);
  }
  function removeWord(id, w) {
    if (!SM) { editBank(id, b => Object.assign({}, b, { words: (b.words || []).filter(x => !(x && x.en === w.en && x.zh === w.zh)) })); return; }
    const d = SM.deleteWord(getBanks(), store.get('sync_del', null), id, norm(w.en), Date.now(), SM.wordHash(w));
    if (d.banks === getBanks()) return;
    if (cloudAccount()) store.set('sync_del', d.tombs);
    saveBanks(d.banks);
  }
  function bankPool(bank) {
    return (bank.words || []).filter(w => w.on !== false)
      .map(w => ({ answer: norm(w.en), zh: w.zh }))
      .filter(w => w.answer && w.answer.length <= 30);
  }
  /* 一行一個:「英文 中文」,也吃逗號/冒號/Tab 分隔 */
  function parseWordLine(line) {
    const s = line.trim();
    if (!s) return null;
    const m = s.match(/^(.+?)[\t,，:：]\s*(.+)$/);
    if (m && !/[一-鿿]/.test(m[1])) return { en: m[1].trim(), zh: m[2].trim() };
    const ci = s.search(/[一-鿿]/);
    if (ci > 0) return { en: s.slice(0, ci).replace(/[\t,，:：\s]+$/, ''), zh: s.slice(ci).trim() };
    return null;
  }

  /* ---------- 路由(頁內狀態) ---------- */
  /* 先看再登入:canKeepProgress 是 js/common.js 這次才有的。上線那幾分鐘瀏覽器可能還拿著快取裡上一版的 common.js(沒有這個函式),
     那時當作可以存,跟改動前一樣;不檢查就會丟錯,已登入的人寫的東西也存不起來 */
  const canKeep = () => typeof canKeepProgress !== 'function' || canKeepProgress();
  /* 題庫編輯器、遊戲裡的作答沒有 data-gate(進來的那一下「新增題庫」「編輯」「開始」才有)。進來之後才因為帳號那一邊存不進去
     (別的分頁登出、換帳號,或這台的帳號資料夾還沒從雲端灌好、這一頁要重新整理):這一下不生效,開「重新整理」卡
     (js/common.js holdForAccount,跟每日練習一樣;多分頁第 3 輪審查 #2)。以前 store.set 靜靜不寫,畫面卻寫「加入 3 個」、清空輸入框、照樣對答案。
     舊版 common.js 沒有這個函式就照舊。回 true = 擋下了 */
  const held = el => typeof holdForAccount === 'function' && holdForAccount(el);
  let pageSrc = null;   // 還沒登入時「練哪些字」的選擇(不存,格式跟 vgame_src 一樣)
  let pickedGame = 'fall';   // 首頁選著的玩法(重畫首頁時留著)

  /* ---------- 共用元件(js/ui.js) ----------
     圖示磚、專心模式(作答中藏導覽、頂端進度、底部回饋條)、結算卡、空狀態、確認視窗都來自 window.UI */
  const artEl = (id, size, cls) => h('canvas', { class: cls, 'data-doodle': id, 'data-size': String(size), 'aria-hidden': 'true' });
  const paintArt = scope => { UI.doodle(scope || root); };
  const emptyBox = (text, action) => UI.empty({ pose: 'sleep', text, action });
  /* 遊戲進行中:藏導覽、頂端換成關閉鈕與進度;底部列留空(遊戲自己有操作區)或放回饋條。離開(關閉鈕確認後)先停掉遊戲 */
  function focusOn(total, onExit, dirty) {
    return UI.focus.enter({ total, onExit, confirmExit: true, dirty: dirty !== false });
  }
  /* 結束畫面:一張結算卡加(有才有)逐字清單,放進 parent 再回傳結算卡(呼叫端接著才呼叫掛勾,點心才畫得進卡裡) */
  function showResult(parent, opt, listTitle, listNodes, wrongN) {
    const card = UI.result(opt);
    parent.append(card.el);
    if (listNodes && listNodes.length) parent.append(UI.detail(listTitle, listNodes, { wrong: wrongN || 0 }));
    try { card.heading.focus({ preventScroll: true }); } catch (e) { /* 沒有焦點也照常顯示 */ }
    return card;
  }
  const wordRows = (list, mark) => h('div', { class: 'vq-list' }, list.map(m => h('div', { class: 'vq-item' + (m.ok === false ? ' bad' : '') },
    h('b', null, m.answer), h('span', null, m.zh), mark ? h('i', null, m.ok ? '✓' : '✗') : null)));

  /* ---------- 練哪些字:可以勾好幾個(文章單字、片語、我的題庫)一起練 ----------
     存在 vgame_src。勾 1 個時跟以前一字不差 { mode, level };勾 2 個以上多一個 modes(清單順序),mode 放第一個勾的、自己就夠玩的題庫
     (沒有就放文章單字或片語,理由見 srcValue):舊版頁面(service worker 快取、別台還沒更新)只看 mode,照常能玩。一個都沒勾不存(這一頁記在 pickNone)。
     讀的時候不回寫:題庫可能是別台建的、開頁時雲端對齊還沒回來,回寫會把它從選擇裡弄丟。
     成績、通關、出過的字:單一來源的鍵跟以前一樣('word'、'phrase'、'bank:<id>');兩個以上用 srcKey 排序後的組合鍵
     (bank:b1+word、phrase+word:e2z、bank:b1+bank:b2:8)。js/move-merge.js 搬家換題庫 id 時用同一套規則重算組合鍵。
     vgame_done 的組合鍵最多留 COMBO_DONE_MAX 個,最近玩的記在 vgame_done['+recent'](見 stopGame)。 */
  const LEVELS = ['全部', '初級', '中級', '中高級', '高級'];
  const MIN_WORDS = { fall: 8, fallBank: 3, pairs: 3, toast: 4, mcq: 4 };   // 掉落消除:有內建字庫要 8 個,全是自己的題庫 3 個
  const COMBO_DONE_MAX = 10;   // vgame_done 最多留幾個組合鍵(雲端每個鍵 256 KB;單一來源的鍵不算、不動)
  const DONE_RECENT = '+recent';   // vgame_done 裡記「組合鍵最近玩的順序」的那一項(開頭是 +,不會跟真的鍵撞)
  let pickOpen = false;        // 清單點開著(雲端合併、別的分頁改題庫重畫首頁時不要自己收起來;重新整理就收起來)
  let pickNone = false;        // 這一頁全部取消了(不存;重畫時照樣一個都沒勾)
  function srcOrder(banks) {
    return ['word', 'phrase'].concat(banks.filter(b => b && typeof b.id === 'string').map(b => 'bank:' + b.id));
  }
  function readSrc(raw, banks) {
    const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    const mode = typeof o.mode === 'string' ? o.mode : '';
    /* modes 裡沒有 mode = 有人只改了 mode(舊版頁面改選單、快取裡舊版的搬家只換 mode):相信 mode */
    const picked = Array.isArray(o.modes) && o.modes.indexOf(mode) > -1 ? o.modes : [mode];
    const modes = srcOrder(banks || getBanks()).filter(m => picked.indexOf(m) > -1);
    return { modes: modes.length ? modes : ['word'], level: LEVELS.indexOf(o.level) > -1 ? o.level : '全部' };
  }
  /* 勾 2 個以上時 mode 放哪一個:舊版頁面只看 mode,它要自己就能玩;快取裡舊版的搬家也只換 mode。
     ① 第一個勾的、自己就夠玩的題庫(soloOk,跟題庫卡片「只練這個」同一個門檻)。
        快取裡舊版的搬家(76b7850 的 js/move-merge.js)只換 mode 裡的題庫 id、不看 modes:mode 是題庫的話,id 換掉之後 mode 就不在 modes 裡,
        readSrc 退回只勾 mode = 學生自己那個改了 id 的題庫。mode 是文章單字的話整個值原封不動,modes 裡的舊 id 會勾到新網址同 id 的另一個題庫。
     ② 勾的題庫都不夠單獨玩(1、2 個字、空的),有勾文章單字或片語就放它:舊版頁面停在一個不夠的題庫,「開始」沒反應或跳「字不夠」,
        學生只好改舊版的選單,又把這台的多選蓋成單選。代價:這時碰到快取裡的舊版搬家、題庫 id 又跟新網址的撞到,會勾到新網址那個題庫。
     ③ 都沒有(只勾了幾個不夠的題庫):第一個題庫。
     (勾了好幾個題庫、只有後面那個改了 id 的,舊版搬家還是會勾錯;要碰到快取裡的舊版搬家頁才會發生) */
  function srcValue(modes, level) {
    if (modes.length < 2) return { mode: modes[0], level };
    const banks = getBanks();
    const isBank = m => m.indexOf('bank:') === 0;
    const solo = modes.find(m => { const b = isBank(m) && banks.find(x => x && 'bank:' + x.id === m); return !!b && soloOk(b); });
    return { mode: solo || modes.find(m => !isBank(m)) || modes[0], level, modes: modes.slice() };
  }
  function srcKey(modes) {
    const u = modes.filter((m, i) => modes.indexOf(m) === i);
    if (u.length === 1) return u[0];
    return u.map(m => (m.indexOf('bank:') === 0 ? 'bank:' + encodeURIComponent(m.slice(5)) : m)).sort().join('+');
  }
  function srcLabel(m, level, banks) {
    if (m === 'word') return '文章單字' + (level !== '全部' ? '（' + level + '）' : '');
    if (m === 'phrase') return '片語';
    const b = banks.find(x => x && 'bank:' + x.id === m);
    return b ? String(b.name || '未命名單字本') : '';
  }
  /* 遊戲標題寫的名稱:3 個以內全寫,4 個以上寫前兩個加「等 N 個」(首頁的框列出全部名稱,數量另外寫在不會被切掉的那一段) */
  function pickLabel(modes, level, banks) {
    const names = modes.map(m => srcLabel(m, level, banks));
    return names.length <= 3 ? names.join('、') : names.slice(0, 2).join('、') + '等 ' + names.length + ' 個';
  }
  const fmtN = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  /* 題庫練幾個字:清單那一列、題庫卡片用同一個數(bankPool:勾選的、英文 30 字以內)。有字沒練就寫「練 N 個」,跟卡片、編輯頁的說法一樣
     (只寫「N 個字」,學生看到比題庫的字少會以為字不見了) */
  const bankOn = b => bankPool(b).length;
  const soloOk = b => bankOn(b) >= MIN_WORDS.fallBank;   // 這個題庫自己就能練(卡片「只練這個」能按;舊版頁面的掉落消除、翻牌也是 3 個)
  const bankCountText = b => (bankOn(b) < (b.words || []).length ? '練 ' + fmtN(bankOn(b)) + ' 個' : fmtN(bankOn(b)) + ' 個字');
  /* 勾的這些合起來的字。live:還在的來源(題庫被刪了就不算),key 照 live 算。
     單一來源跟以前一模一樣(題庫照 bankPool,不另外去重複);兩個以上同一個英文只留一個:
     自己的題庫優先(照「我的題庫」的順序,學生寫的中文是照課本或老師的),再來文章單字(級別只篩它)、片語 */
  function srcPool(modes, level) {
    const banks = getBanks();
    const live = srcOrder(banks).filter(m => modes.indexOf(m) > -1);
    const out = { live, key: live.length ? srcKey(live) : '', banksOnly: !!live.length && live.every(m => m.indexOf('bank:') === 0), pool: [], name: '' };
    const bankFor = m => banks.find(b => b && 'bank:' + b.id === m);
    if (live.length === 1) {
      const m = live[0];
      if (m === 'word') { out.pool = buildWordPool(level); out.name = '單字' + (level !== '全部' ? ' · ' + level : ''); }
      else if (m === 'phrase') { out.pool = buildPhrasePool(); out.name = '片語'; }
      else { const b = bankFor(m); out.pool = bankPool(b); out.name = '單字本：' + b.name; }
    } else if (live.length) {
      const seen = new Set();
      const add = list => list.forEach(p => { const k = norm(p.answer); if (!seen.has(k)) { seen.add(k); out.pool.push(p); } });
      live.filter(m => m.indexOf('bank:') === 0).forEach(m => add(bankPool(bankFor(m))));
      if (live.indexOf('word') > -1) add(buildWordPool(level));
      if (live.indexOf('phrase') > -1) add(buildPhrasePool());
      out.name = pickLabel(live, level, banks);
    }
    return out;
  }
  /* 唯讀,給測試與搬家對照組合鍵用(tools/test_vocab_multi.js) */
  window.VOCAB_SRC = Object.freeze({
    read: readSrc, value: srcValue, key: srcKey,
    pool: (modes, level) => { const s = srcPool(modes, level); return { live: s.live.slice(), key: s.key, banksOnly: s.banksOnly, name: s.name, pool: s.pool.map(p => ({ answer: p.answer, zh: p.zh })) }; },
  });

  renderHome();
  /* 開了好幾天的 App 一進單字頁先跟雲端對齊(CLOUD.syncKey),之後的編輯才不是根據舊資料;
     有變(別台加的題庫合併進來)、或別的分頁改了題庫,畫面在首頁或編輯頁時重畫,遊戲中不打斷 */
  let editRedraw = null;
  function redrawBanks() {
    if (root.querySelector('[data-vview="home"]')) renderHome();
    else if (editRedraw && root.querySelector('[data-vview="edit"]')) editRedraw();
  }
  if (window.CLOUD && typeof CLOUD.syncKey === 'function') {
    CLOUD.syncKey('vgame_banks').then(r => { if (r && r.changed) redrawBanks(); }, () => {});
  }
  window.addEventListener('cloud:merged', e => { if (e && e.detail && e.detail.key === 'vgame_banks') redrawBanks(); });
  window.addEventListener('storage', e => { if (e && e.key === storageKey('vgame_banks')) redrawBanks(); });

  function renderHome() {
    document.title = '單字訓練 - 衝衝英文';
    root.innerHTML = '';
    if (location.hash === '#phrase') { renderPhrases(); return; }
    root.append(h('div', { class: 'page-head', 'data-vview': 'home' }, artEl('vocab', 40, 'hub-art'), h('h1', null, '單字訓練')));

    const missCount = Object.keys(store.get('vgame_miss', {})).length;
    const banks = getBanks();

    /* 第一步:勾要練哪些字(四種玩法共用,記住上次勾的)。外觀像下拉選單,點開是一列一個的勾選清單
       (照 Anki 自訂學習、Quizlet 合併學習集:勾好幾個 = 一起練;樣式跟刷題頁的 cfg-part-row 同一套:勾選框+名稱,級別選單放同一列)。
       用 <details>:鍵盤、報讀都是原生的,舊版 style.css 沒有新樣式時也照樣能開能勾。勾、取消馬上生效,沒有「套用」 */
    const order = srcOrder(banks);
    const saved = readSrc(pageSrc || store.get('vgame_src', null), banks);
    let level = saved.level;
    let picked = pickNone ? [] : saved.modes;
    const levelSel = h('select', { class: 'cfg-select', 'aria-label': '文章單字的級別' },
      LEVELS.map(l => h('option', { value: l }, l === '全部' ? '全部級別' : l)));
    levelSel.value = level;
    const boxes = {}, counts = {};
    const pickRow = (m, name, extra) => {
      const cb = h('input', { type: 'checkbox', value: m });
      cb.checked = picked.indexOf(m) > -1;
      cb.addEventListener('change', onPick);
      boxes[m] = cb;
      counts[m] = h('span', { class: 'vg-pick-n' });
      /* 整列(勾選框、名稱、字數)都在 label 裡,點哪裡都能勾;級別選單在 label 外面,點它不會切換勾選 */
      return h('div', { class: 'vg-pick-row' },
        h('label', { class: 'vg-pick-check' }, cb, h('span', { class: 'vg-pick-name', title: name }, name), counts[m]), extra || null);
    };
    const bankModes = order.filter(m => m.indexOf('bank:') === 0);
    let allBox = null;
    if (bankModes.length > 1) {
      allBox = h('input', { type: 'checkbox' });
      allBox.addEventListener('change', () => { bankModes.forEach(m => { boxes[m].checked = allBox.checked; }); onPick(); });
    }
    const wordRow = pickRow('word', '文章單字', levelSel);
    const phraseRow = pickRow('phrase', '片語');
    const bankRows = banks.filter(b => b && typeof b.id === 'string').map(b => pickRow('bank:' + b.id, String(b.name || '未命名單字本')));
    /* 框裡兩段:勾了哪些(全部名稱,太長就省略號,點開看得到全名)+ 勾了幾個、合起來幾個字(這段不切)。
       老師按週出的題庫名稱很長,手機上常常只看得到第一個名稱,要靠後面的「N 個」才知道勾了幾個(跟常見的多選下拉一樣,名稱放不下時數量照樣看得到)。
       框的名稱(報讀軟體、語音控制)從框裡的字來,開頭放一段只給報讀軟體的「練哪些字」(WCAG 2.5.3:名稱要含看得到的標籤)。
       不用 aria-labelledby:那樣 Chrome 會把框裡的字再放進描述,報讀軟體唸兩次。旁邊看得到的「練哪些字」就 aria-hidden,瀏覽模式不重複唸 */
    const sumText = h('span', { class: 'vg-pick-sum-text' });
    const sumCount = h('span', { class: 'vg-pick-sum-n' });
    const note = h('p', { class: 'vg-pick-note', 'aria-live': 'polite' });
    /* 全選照常見的做法(Gmail、雲端硬碟的列表):是「我的題庫」那組的第一列,勾選框跟下面各列同一欄,小標題在它上面 */
    const picker = h('details', { class: 'vg-pick', open: pickOpen ? '' : null },
      h('summary', { class: 'cfg-select vg-pick-sum' }, h('span', { class: 'vg-pick-legend' }, '練哪些字 '), sumText, sumCount),
      h('div', { class: 'vg-pick-panel' },
        h('fieldset', { class: 'vg-pick-list' },
          h('legend', { class: 'vg-pick-legend' }, '練哪些字'),
          wordRow, phraseRow,
          bankRows.length ? h('div', { class: 'vg-pick-banks', role: 'group', 'aria-labelledby': 'vg-pick-banks-h' },
            h('div', { class: 'vg-pick-group', id: 'vg-pick-banks-h' }, '我的單字本'),
            allBox ? h('div', { class: 'vg-pick-row' }, h('label', { class: 'vg-pick-check vg-pick-all' }, allBox, h('span', null, '全選'))) : null,
            bankRows) : null),
        note));
    picker.addEventListener('toggle', () => { pickOpen = picker.open; });
    /* 開著按 Esc:收起來、焦點回到框上(框長得像下拉選單,下拉選單的慣例就是這樣;不然鍵盤只能 Shift+Tab 回框上再按 Enter)。
       點外面不收:清單是推開下面的內容,不是浮在上面 */
    picker.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || !picker.open) return;
      e.preventDefault();
      picker.open = false;
      picker.querySelector('summary').focus();
    });
    counts.phrase.textContent = fmtN(buildPhrasePool().length) + ' 個字';
    banks.filter(b => b && typeof b.id === 'string').forEach(b => { counts['bank:' + b.id].textContent = bankCountText(b); });
    /* 改級別 = 要練文章單字,順便勾起來(跟刷題頁改題數會勾起那一列一樣) */
    levelSel.addEventListener('change', () => { boxes.word.checked = true; onPick(); });
    function onPick() {
      picked = order.filter(m => boxes[m].checked);
      level = levelSel.value;
      pickNone = !picked.length;
      if (picked.length) {
        const v = srcValue(picked, level);
        if (canKeep()) store.set('vgame_src', v);
        else pageSrc = v;   // 還沒登入(先看再登入):勾了照樣換,只記在這一頁
      }
      refreshPick();
    }
    /* 玩法磚:選一個(單選),選項與唯一的主按鈕「開始」在磚下面。磚上只有名稱與一行數字 */
    const gamesGrid = h('div', { class: 'tile-grid vg-games' });
    const startBox = h('div', { class: 'vg-start' });
    const playWrap = h('div', { class: 'vg-play' }, gamesGrid, startBox);
    root.append(h('div', { class: 'vg-source' }, h('span', { 'aria-hidden': 'true' }, '練哪些字'), picker), playWrap);

    /* 第二步:選玩法。四塊磚選一個,選項放在磚下面 */
    const speedSel = h('select', { class: 'cfg-select', 'aria-label': '掉落速度' },
      [['slow', '輕鬆'], ['normal', '標準'], ['fast', '快速']].map(([v, t]) => {
        const o = h('option', { value: v }, t);
        if (v === 'normal') o.selected = true;
        return o;
      }));
    const dirSel = h('select', { class: 'cfg-select', 'aria-label': '掉落消除的方向' },
      [['z2e', '中翻英'], ['e2z', '英翻中']].map(([v, t]) => h('option', { value: v }, t)));
    const dirSel2 = h('select', { class: 'cfg-select', 'aria-label': '選擇題的方向' },
      [['e2z', '看英文選中文'], ['z2e', '看中文選英文']].map(([v, t]) => h('option', { value: v }, t)));

    /* 玩法大圖示:黃色=圓順的螢光筆塊,線條=潦草的原子筆(濾鏡抖線)。之後可整組換成手繪稿。 */
    const PEN = 'fill="none" stroke="#222b36" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" filter="url(#vgPen)"';
    const PEN_DEF = '<filter id="vgPen" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="5"/><feDisplacementMap in="SourceGraphic" scale="2.4"/></filter>';
    const svg = inner => '<svg viewBox="0 0 84 84" aria-hidden="true">' + PEN_DEF + inner + '</svg>';
    const VG_ICON = {
      /* 掉落消除:三塊字卡往下掉,最下面那塊被螢光筆刷到 */
      fall: svg('<path d="M10 58c8-7 50-9 64-2c5 6 1 14-5 16c-16 4-44 4-56-1c-6-3-7-9-3-13z" fill="#ffd84d"/>'
        + '<g ' + PEN + '><rect x="12" y="8" width="24" height="15" rx="4"/><rect x="46" y="22" width="26" height="15" rx="4"/><rect x="24" y="52" width="36" height="17" rx="4"/>'
        + '<path d="M24 28v9M58 42v6M18 34v4"/></g>'),
      /* 翻牌配對:兩張牌,一張翻開 */
      pairs: svg('<path d="M40 16c10-6 28-2 32 8c4 12 1 34-6 42c-8 6-22 4-27-3c-6-12-6-36 1-47z" fill="#ffd84d"/>'
        + '<g ' + PEN + '><rect x="10" y="18" width="30" height="42" rx="5" transform="rotate(-8 25 39)"/><rect x="42" y="22" width="30" height="42" rx="5" transform="rotate(7 57 43)"/>'
        + '<path d="M20 34l5 -2M22 44l8 -2"/><path d="M52 38c3-5 9-4 10 1c1 4-4 6-5 10M57 55v1"/></g>'),
      /* 記憶吐司:一片吐司+計時的三條熱氣 */
      toast: svg('<path d="M18 40c-6-10 2-24 22-25c22-1 32 12 26 25c1 12 2 24-2 30c-12 4-34 4-44 0c-4-8-3-20-2-30z" fill="#ffd84d"/>'
        + '<g ' + PEN + '><path d="M20 40c-7-9 0-23 21-24c22-1 31 13 24 24v26c0 3-2 5-5 5H25c-3 0-5-2-5-5z"/>'
        + '<path d="M33 46h1M50 46h1M35 56c4 4 10 4 14 0"/><path d="M30 6c-2 3 2 4 0 7M42 4c-2 3 2 4 0 7M54 6c-2 3 2 4 0 7"/></g>'),
      /* 單字選擇題:三個選項圈,其中一個打勾 */
      mcq: svg('<path d="M8 34c10-6 56-8 68-1c4 5 2 12-3 14c-16 4-50 5-63 0c-5-3-6-9-2-13z" fill="#ffd84d"/>'
        + '<g ' + PEN + '><circle cx="18" cy="16" r="7"/><path d="M32 16h36"/><circle cx="18" cy="40" r="7"/><path d="M32 40h40"/><circle cx="18" cy="64" r="7"/><path d="M32 64h30"/>'
        + '<path d="M13 40l4 5l9-12"/></g>'),
      /* 片語特訓:對話框裡兩行字 */
      phrase: svg('<path d="M8 22c10-8 56-10 68-1c4 7 2 22-3 26c-16 5-40 5-54 1c-6-5-14-14-11-26z" fill="#ffd84d"/>'
        + '<g ' + PEN + '><path d="M14 14h56c4 0 6 2 6 6v24c0 4-2 6-6 6H38l-12 12V50H14c-4 0-6-2-6-6V20c0-4 2-6 6-6z"/><path d="M20 26h38M20 37h24"/></g>'),
    };

    /* 一塊磚:圖、名稱、一行數字。選到的磚外框變主色。不能玩的磚,數字改寫原因 */
    let keepFocus = false;
    function drawGames(src) {
      const key = src.key, n = src.pool.length, modes = src.live.slice();
      const whyOf = min => (!modes.length ? '先在上面勾要練的字' : n < min ? '字不夠 · 要 ' + min + ' 個以上' : '');
      const best = key ? store.get('vgame_best', {}) : {};
      const fallBest = [best[key] ? '中翻英 ' + best[key] : '', best[key + ':e2z'] ? '英翻中 ' + best[key + ':e2z'] : ''].filter(Boolean).join(' · ');
      const pb = key ? Object.entries(store.get('vgame_pairs_best', {})).filter(([k]) => k.startsWith(key + ':')).map(([, v]) => v)[0] : null;
      const tb = key ? store.get('vgame_toast_best', {})[key] : 0;
      const defs = [
        { k: 'fall', name: '掉落消除', min: src.banksOnly ? MIN_WORDS.fallBank : MIN_WORDS.fall,
          num: fallBest ? '最佳 ' + fallBest : missCount ? '漏接 ' + missCount + ' 個' : '一關 20 個字',
          opts: [dirSel, speedSel], go: () => startGame(modes, level, speedSel.value, dirSel.value) },
        { k: 'pairs', name: '翻牌配對', min: MIN_WORDS.pairs,
          num: pb ? '最佳 ' + pb.moves + ' 步 · ' + pb.secs + ' 秒' : '8 對',
          opts: [], go: () => startPairs(modes, level) },
        { k: 'toast', name: '記憶吐司', min: MIN_WORDS.toast,
          num: tb ? '最佳 ' + tb + ' / 6' : '15 秒記 6 個字',
          opts: [], go: () => startToast(modes, level) },
        { k: 'mcq', name: '單字選擇題', min: MIN_WORDS.mcq,
          num: '四選一 · 10 題',
          opts: [dirSel2], go: () => startMcq(modes, level, dirSel2.value) },
      ];
      defs.forEach(d => { d.why = whyOf(d.min); });
      const cur = defs.find(d => d.k === pickedGame) || defs[0];
      gamesGrid.innerHTML = '';
      let curTile = null;
      defs.forEach(d => {
        const on = d === cur;
        const tile = h('button', {
          class: 'module-card tile vg-tile' + (on ? ' on' : '') + (d.why ? ' is-blocked' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false',
          onclick: () => { pickedGame = d.k; keepFocus = true; drawGames(src); },
        }, h('span', { class: 'vg-art', html: VG_ICON[d.k] }), h('span', { class: 'vg-tile-name' }, d.name), h('span', { class: 'vg-tile-num' }, d.why || d.num));
        if (on) curTile = tile;
        gamesGrid.append(tile);
      });
      /* 選項與唯一的主按鈕。開始遊戲:沒登入時 js/profile.js 先攔下 */
      startBox.innerHTML = '';
      if (cur.opts.length) startBox.append(h('div', { class: 'vg-opts' }, cur.opts));
      startBox.append(h('button', { class: 'btn primary vg-go', 'data-gate': '', disabled: cur.why ? '' : null, onclick: cur.go }, '開始'));
      if (keepFocus && curTile) curTile.focus();
      keepFocus = false;
    }
    /* 勾了什麼 → 框裡的字、清單下面的說明、全選的狀態、四塊磚 */
    function refreshPick() {
      const src = srcPool(picked, level);
      const n = src.pool.length;
      counts.word.textContent = fmtN(buildWordPool(level).length) + ' 個字';
      sumText.textContent = picked.length ? picked.map(m => srcLabel(m, level, banks)).join('、') : '還沒勾';
      sumCount.textContent = !picked.length ? '' : (picked.length > 1 ? ' · ' + picked.length + ' 個' : '') + ' · 共 ' + fmtN(n) + ' 個字';
      const few = picked.length && n < MIN_WORDS.pairs;
      note.textContent = !picked.length ? '至少勾一個'
        : few ? '只有 ' + n + ' 個字 · 至少要 ' + MIN_WORDS.pairs + ' 個才能玩' : '共 ' + fmtN(n) + ' 個字';
      note.classList.toggle('warn', !picked.length || !!few);
      if (allBox) {
        const on = bankModes.filter(m => boxes[m].checked).length;
        allBox.checked = on === bankModes.length;
        allBox.indeterminate = on > 0 && on < bankModes.length;
      }
      drawGames(src);
    }
    refreshPick();

    /* 片語特訓的入口:跟玩法同一種磚,點了到片語頁(網址 #phrase,練完回來還在那一頁) */
    root.append(h('a', {
      class: 'module-card tile vg-phrase-tile', href: '#phrase',
      onclick: e => { e.preventDefault(); history.replaceState(null, '', '#phrase'); renderHome(); },
    }, h('span', { class: 'vg-art', html: VG_ICON.phrase }), h('span', { class: 'vg-tile-name' }, '片語特訓'),
    h('span', { class: 'vg-tile-num' }, PHRASES.length ? PHRASES.length + ' 條' : '準備中')));

    /* 我的單字本:只管建立與編輯;要練就在上面勾,或按卡片上的「只練這個」 */
    root.append(h('div', { class: 'exercise-head' },
      h('h2', null, '我的單字本'),
      h('button', { class: 'btn', style: 'margin-left:auto', 'data-gate': '', onclick: () => renderBankEdit(null) }, '新增單字本')));
    if (!banks.length) {
      root.append(emptyBox('還沒有單字本'));
    } else {
      const bwrap = h('div', { class: 'part-cards vg-bank-cards' });
      banks.forEach(b => {
        const onCount = bankOn(b);   // 跟上面清單那一列同一個數
        const playable = soloOk(b);
        bwrap.append(h('div', { class: 'part-card' },
          h('h3', null, b.name),
          /* 「練 N 個」:單字本編輯頁裡勾的字(跟上面「練哪些字」的勾選是兩回事,所以不寫「已勾選」) */
          h('div', { class: 'p-stats' }, (b.words || []).length + ' 個字 · 練 ' + onCount + ' 個' + (playable ? '' : ' · 要 3 個以上才能單獨練')),
          h('div', { class: 'cfg-row vg-bank-btns' },
            /* 只練這個 = 上面清單只勾它(跟以前「用這個題庫」一樣是換成它;要一起練就在上面清單多勾)。
               只寫四個字:三顆按鈕排一行(手機上卡片是一欄整寬,style.css 的 .vg-bank-cards)。
               焦點移到上面的框:鍵盤接著從這裡用,報讀軟體唸出新的框名稱(清單收起來時 aria-live 的說明不會唸) */
            h('button', {
              class: 'btn', disabled: playable ? null : '',
              onclick: () => {
                if (!boxes['bank:' + b.id]) return;
                order.forEach(m => { boxes[m].checked = m === 'bank:' + b.id; });
                onPick();
                picker.querySelector('summary').focus({ preventScroll: true });
                window.scrollTo({ top: 0, behavior: 'smooth' });
              },
            }, '只練這個'),
            h('button', { class: 'btn', 'data-gate': '', onclick: () => renderBankEdit(b.id) }, '編輯'),
            h('button', {
              class: 'btn', 'data-gate': '', onclick: () => {
                UI.confirm({ title: '刪除「' + b.name + '」？', body: '單字會一起刪掉', ok: '刪除', cancel: '取消', danger: true })
                  .then(yes => { if (!yes) return; removeBank(b.id); renderHome(); });
              },
            }, '刪除'))));
      });
      root.append(bwrap);
    }
    paintArt(root);
  }

  /* ================= 片語特訓:家族清單 ================= */
  function renderPhrases() {
    document.title = '片語特訓 - 衝衝英文';
    root.innerHTML = '';
    root.append(h('div', { class: 'drill-top', 'data-vview': 'phrase' },
      h('h1', null, '片語特訓'),
      h('a', { href: 'vocab.html', style: 'font-size:13.5px;margin-left:auto', onclick: e => { e.preventDefault(); history.replaceState(null, '', location.pathname + location.search); renderHome(); } }, '← 回單字訓練')));
    if (!PHRASES.length) {
      root.append(emptyBox('片語準備中', { label: '重新整理', onClick: () => location.reload() }));
      return;
    }
    /* 動詞片語按家族分組;形容詞+介系詞/動詞+介系詞/慣用語各成一大組 */
    const groups = {};
    PHRASES.forEach(p => {
      const g = (p.type && p.type !== '動詞片語') ? p.type : (p.group || '其他');
      (groups[g] = groups[g] || []).push(p);
    });
    const drillSt = store.get('phrase_drill', {});
    const wrap = h('div', { class: 'part-cards', style: 'grid-template-columns:1fr 1fr' });
    Object.entries(groups).forEach(([g, items]) => {
      const done = items.filter(p => (drillSt[p.id] || {}).ok).length;
      const pct = Math.round(done / items.length * 100);
      const table = h('div', { class: 'phrase-table', style: 'display:none' },
        items.map(p => h('div', { class: 'phrase-row' },
          h('b', null, p.phrase),
          h('span', { class: 'ph-zh' }, p.zh),
          h('span', { class: 'ph-ex' }, p.example))));
      const toggleBtn = h('button', {
        class: 'pop-mini', type: 'button',
        onclick: () => {
          const open = table.style.display !== 'none';
          table.style.display = open ? 'none' : '';
          toggleBtn.textContent = open ? '看片語表' : '收起';
        },
      }, '看片語表');
      wrap.append(h('div', { class: 'part-card' },
        h('h3', null, g),
        h('div', { class: 'p-stats' }, items.length + ' 條 · 已答對 ' + done),
        h('div', { class: 'bar' }, h('i', { style: 'width:' + pct + '%' })),
        h('div', { class: 'cfg-row' },
          h('button', { class: 'btn', 'data-gate': '', onclick: () => startDrill(g, items) }, '開始'),
          toggleBtn),
        table));
    });
    root.append(wrap, h('div', { style: 'height:40px' }));
  }

  /* ================= 題庫編輯 ================= */
  function renderBankEdit(bankId) {
    const id = bankId || (SM ? SM.newBankId(Date.now()) : 'b' + Date.now().toString(36));
    const current = () => bankOf(id) || { id, name: '', words: [] };   // 每次都重讀(別的分頁、別台合併進來的才看得到)
    const bank = current();
    document.title = '編輯單字本 - 衝衝英文';
    root.innerHTML = '';
    const nameInput = h('input', {
      class: 'game-input', type: 'text', value: bank.name,
      placeholder: '單字本名稱', maxlength: '20', style: 'max-width:320px',
    });
    const bulkInput = h('textarea', {
      class: 'write-area', style: 'min-height:110px',
      placeholder: '一行一個「英文 中文」\napple 蘋果\nput on 穿上\nschedule 行程表',
    });
    const status = h('div', { class: 'result-note' });
    const listWrap = h('div', null);

    /* 名稱欄位:shownName 是最後一次放進輸入框(或存過)的名稱。輸入框跟它一樣 = 學生沒動過名稱,
       persist 就不寫名稱(題庫已經存在時),重畫時換成本機現在的名稱(別台改的名稱合併進來了)。
       以前每次 persist 都把輸入框的值寫回去:輸入框還停在合併前的舊名稱時,會把別台的改名蓋掉(而且 _nt 是新的,之後每台都用舊名稱) */
    let shownName = nameInput.value;
    /* 回 false = 存不進去(held:開了「重新整理」卡),呼叫的地方就停下,輸入框照原樣留著 */
    function persist() {
      const typed = nameInput.value;
      if (typed === shownName && bankOf(id)) return true;
      if (held(nameInput)) return false;
      const name = typed.trim() || '未命名單字本';
      editBank(id, b => Object.assign({}, b, { name }));
      shownName = typed;
      return true;
    }
    function syncName() {
      const b = bankOf(id);
      if (b && nameInput.value === shownName && typeof b.name === 'string' && b.name !== shownName) {
        nameInput.value = b.name;
        shownName = b.name;
      }
    }
    function redraw() { syncName(); drawList(); }
    function drawList() {
      listWrap.innerHTML = '';
      const words = (current().words || []).filter(w => w && typeof w.en === 'string');
      if (!words.length) return;
      const onCount = words.filter(w => w.on !== false).length;
      listWrap.append(h('div', { class: 'p-stats', style: 'margin:14px 0 6px' },
        words.length + ' 個字 · 練 ' + onCount + ' 個'));
      words.forEach(w => {
        const cb = h('input', { type: 'checkbox' });
        cb.checked = w.on !== false;
        cb.addEventListener('click', e => { if (held(cb)) e.preventDefault(); });   // 擋下時勾選不變(點文字、空白鍵也是走 click)
        cb.addEventListener('change', () => { if (!persist()) return; editWord(id, w, { on: cb.checked }); drawList(); });
        const alt = Array.isArray(w.alt) ? w.alt.filter(a => typeof a === 'string' && a.trim()) : [];
        listWrap.append(h('div', { class: 'bank-word' + (alt.length ? ' has-alt' : '') },
          h('label', { class: 'bank-word-main' }, cb,
            h('b', null, w.en), h('span', { class: 'bank-word-zh' }, w.zh)),
          h('button', {
            class: 'bank-word-del', type: 'button', title: '刪除這個字',
            onclick: e => { if (held(e.currentTarget) || !persist()) return; removeWord(id, w); drawList(); },
          }, '✕'),
          /* 兩台同時改了這個字的中文:沒當主要的那個放在 alt(同步合併設計 3.7.3),可以換成它或刪掉 */
          alt.map(a => h('div', { class: 'bank-word-alt' },
            h('span', null, '另一台寫的：' + a),
            h('button', { class: 'pop-mini', type: 'button', onclick: e => { if (held(e.currentTarget)) return; editWord(id, w, { zh: a, alt: alt.filter(x => x !== a) }); drawList(); } }, '換成這個'),
            h('button', { class: 'pop-mini', type: 'button', onclick: e => { if (held(e.currentTarget)) return; editWord(id, w, { alt: alt.filter(x => x !== a) }); drawList(); } }, '刪掉')))));
      });
    }
    function addBulk(e) {
      if (held(e && e.currentTarget) || !persist()) return;   // 擋下時不清空輸入框、不寫「加入 N 個」
      const lines = bulkInput.value.split('\n');
      let added = 0, updated = 0, skipped = 0;
      const seen = new Set((current().words || []).filter(w => w && typeof w.en === 'string').map(w => norm(w.en)));
      const list = [];
      lines.forEach(line => {
        const p = parseWordLine(line);
        if (!p || !p.en || !p.zh || p.en.length > 30) { if (line.trim()) skipped++; return; }
        const key = norm(p.en);
        if (seen.has(key)) updated++;
        else { seen.add(key); added++; }
        list.push({ en: p.en, zh: p.zh });
      });
      if (list.length) {
        editBank(id, b => {
          if (SM) return SM.addWords(b, list, Date.now());
          const words = (b.words || []).slice();
          list.forEach(p => {
            const i = words.findIndex(w => norm(w.en) === norm(p.en));
            if (i >= 0) words[i] = Object.assign({}, words[i], { zh: p.zh }); else words.push({ en: p.en, zh: p.zh, on: true });
          });
          return Object.assign({}, b, { words });
        });
      }
      bulkInput.value = '';
      status.textContent = '加入 ' + added + ' 個' + (updated ? ' · 更新 ' + updated + ' 個' : '') +
        (skipped ? ' · ' + skipped + ' 行看不懂' : '');
      drawList();
    }

    nameInput.addEventListener('change', persist);
    editRedraw = redraw;
    root.append(
      h('div', { class: 'drill-top', 'data-vview': 'edit' },
        h('h1', null, bankId ? '編輯單字本' : '新增單字本'),
        h('a', { href: 'vocab.html', style: 'font-size:13.5px;margin-left:auto', onclick: e => { e.preventDefault(); if (persist()) renderHome(); } }, '← 回單字訓練')),
      h('div', { class: 'q-block' },
        nameInput,
        bulkInput,
        h('div', { class: 'pop-btns', style: 'margin-top:10px' },
          h('button', { class: 'btn primary', type: 'button', onclick: addBulk }, '加入單字')),
        status,
        listWrap));
    drawList();
    if (!bankId) nameInput.focus();
  }

  /* vgame_done 的組合鍵(好幾個來源一起練)超過 COMBO_DONE_MAX 個,就刪最久沒玩的(只是「出過哪些字」的輪替,分數、通關不受影響)。
     最近玩的順序記在 doneLog['+recent'](組合鍵的陣列,最近玩的在最後),不看物件裡鍵的順序:雲端 progress.v 是 jsonb,鍵的順序存不住
     (灌回來時照長度、再照位元組排),換一台、重新登入就亂了;陣列的順序存得住。
     沒記在 +recent 裡的組合鍵(例如搬家換了題庫 id 複製出來的)當成最久沒玩,照物件裡的順序先刪。
     +recent 開頭是 +:真的組合鍵每一段都不是空的,不會撞;舊版頁面只讀寫自己的單一來源鍵,整份照原樣存回去;
     搬家(新版、舊版 js/move-merge.js)換題庫 id 時不動它。單一來源的鍵順序、內容都不動 */
  function trimCombos(doneLog, key) {
    const isCombo = k => k.indexOf('+') > 0;
    const had = Array.isArray(doneLog[DONE_RECENT]) ? doneLog[DONE_RECENT] : [];
    const recent = had.filter((k, i) => typeof k === 'string' && k !== key && isCombo(k) && Array.isArray(doneLog[k]) && had.indexOf(k) === i).concat(key);
    const combos = Object.keys(doneLog).filter(isCombo);
    const drop = combos.map((k, i) => ({ k, at: recent.indexOf(k), i }))
      .sort((a, b) => a.at - b.at || a.i - b.i)
      .slice(0, Math.max(0, combos.length - COMBO_DONE_MAX)).map(x => x.k);
    drop.forEach(k => { delete doneLog[k]; });
    doneLog[DONE_RECENT] = recent.filter(k => drop.indexOf(k) < 0);
  }

  /* ================= 掉落遊戲 ================= */
  /* modes:勾的來源(['word']、['bank:b1', 'phrase']…)。開始時再算一次(別的分頁可能剛刪了其中一個題庫:照剩下的玩,不夠就回首頁) */
  function startGame(modes, levelName, speedKey, dir) {
    dir = dir === 'e2z' ? 'e2z' : 'z2e';
    const src = srcPool(modes, levelName);
    const pool = src.pool;
    const banksOnly = src.banksOnly;   // 全是自己的題庫:一關最多 30 個、至少 3 個,中文一樣的照樣都出
    if (!src.live.length || pool.length < (banksOnly ? MIN_WORDS.fallBank : MIN_WORDS.fall)) { renderHome(); return; }
    document.title = '掉落消除 - 衝衝英文';
    root.innerHTML = '';

    const BASE_SPEED = { slow: 15, normal: 23, fast: 34 }[speedKey];
    const missPool = store.get('vgame_miss', {});
    const bestKey = src.key + (dir === 'e2z' ? ':e2z' : '');
    let score = 0, lives = 3, combo = 0;
    let blocks = [];
    let lastSpawn = 0, lastTime = 0, playMs = 0;
    let running = true, over = false;
    let rafId = null;
    const missedThisGame = [];

    /* 這一關的字:自訂題庫=整個題庫(最多 30 個);內建字庫=20 個,
       以前漏接的優先,其次是最近幾關沒出過的。打對的字這一關不再出現,漏接的過兩三個字會再掉下來,全部打對就通關。 */
    const shuffle = arr => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const uniq = [...new Map(pool.map(p => [p.answer, p])).values()];
    const ROUND_N = banksOnly ? Math.min(30, uniq.length) : Math.min(20, uniq.length);
    const doneLog = store.get('vgame_done', {});
    const doneIdx = new Map((doneLog[bestKey] || []).map((a, i) => [a, i]));   // 越前面=越久沒出
    const missed = shuffle(uniq.filter(p => missPool[p.answer]));
    const fresh = shuffle(uniq.filter(p => !missPool[p.answer] && !doneIdx.has(p.answer)));
    const seen = uniq.filter(p => !missPool[p.answer] && doneIdx.has(p.answer))
      .sort((a, b) => doneIdx.get(a.answer) - doneIdx.get(b.answer));
    /* 畫面上看到的那一面:中翻英看中文、英翻中看英文。內建字庫有幾組中文相同的字(同事=co-worker、colleague),一關只放一個 */
    const shownOf = p => (dir === 'e2z' ? p.answer : p.zh);
    const usedShown = new Set();
    const roundItems = [];
    for (const p of [...missed, ...fresh, ...seen]) {
      if (roundItems.length >= ROUND_N) break;
      if (!banksOnly && usedShown.has(shownOf(p))) continue;
      usedShown.add(shownOf(p));
      roundItems.push(p);
    }
    /* 中文相同的字(同事=co-worker、colleague;題庫裡 big、large 都是「大」):打字庫裡任何一個對應的英文都算對 */
    const sameZh = {};
    uniq.forEach(p => { (sameZh[p.zh] = sameZh[p.zh] || new Set()).add(norm(p.answer)); });
    const total = roundItems.length;
    const queue = shuffle(roundItems);     // 還沒打對、也不在畫面上的字
    const cleared = new Set();             // 這一關打對的字
    let firstTry = 0;                      // 第一次掉下來就打對的字數
    const missedOnce = new Set();          // 這一關漏接過的字(之後補打對的會列在通關畫面)

    const scoreEl = h('span', { class: 'hud-score' }, '0');
    const livesEl = h('span', { class: 'hud-lives' });
    const field = h('div', { class: 'game-field' });
    const input = h('input', {
      class: 'game-input', type: 'text',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: dir === 'e2z' ? '打出中文意思按 Enter' : '打出英文按 Enter',
    });
    const pauseBtn = h('button', { class: 'btn', type: 'button', onclick: togglePause }, '暫停');

    function drawLives() {
      livesEl.textContent = '♥'.repeat(lives) + '♡'.repeat(3 - lives);
    }
    drawLives();

    /* 進行中:藏導覽,頂端是關閉鈕與進度(打對幾個 / 這一關幾個);底部列留空。關閉要先確認,離開時停掉遊戲 */
    const f = focusOn(total, () => { abandon(); renderHome(); });
    root.append(
      h('div', { class: 'drill-top' },
        h('h1', null, '掉落消除 ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' },
          src.name + ' · ' + (dir === 'e2z' ? '英翻中' : '中翻英')))),
      h('div', { class: 'game-hud' },
        h('span', null, '分數 ', scoreEl), livesEl, pauseBtn),
      field,
      h('div', { class: 'game-input-row' }, input));
    input.focus();

    function spawn() {
      const onScreen = new Set(blocks.map(b => shownOf(b.item)));
      const qi = queue.findIndex(it => !onScreen.has(shownOf(it)));
      if (qi < 0) return;
      const item = queue.splice(qi, 1)[0];
      /* 中翻英:中文掉下來+字首提示;英翻中:英文掉下來+中文字數提示 */
      const shown = dir === 'e2z' ? item.answer : item.zh;
      const hintText = dir === 'e2z' ? '◯'.repeat(zhVariants(item.zh)[0].length) : hint(item.answer);
      const el = h('div', { class: 'fall-block' },
        h('div', { class: 'fb-zh' }, shown),
        h('div', { class: 'fb-hint' }, hintText));
      field.append(el);
      const maxX = Math.max(0, field.clientWidth - el.offsetWidth - 8);
      const x = 4 + Math.random() * maxX;
      el.style.left = x + 'px';
      blocks.push({ el, item, answer: item.answer, zh: item.zh, y: -el.offsetHeight, speed: BASE_SPEED * (1 + Math.min(0.4, score / 500)) });
    }

    function loop(t) {
      if (!running) return;
      if (!lastTime) lastTime = t;
      playMs += Math.min(250, t - lastTime);
      const dt = Math.min(0.05, (t - lastTime) / 1000);
      lastTime = t;
      const interval = Math.max(1600, 3200 - score * 8);
      /* 畫面空了就馬上出下一個字,不用乾等 */
      if (queue.length && blocks.length < 4 && (t - lastSpawn > interval || !blocks.length)) {
        lastSpawn = t;
        spawn();
      }
      const H = field.clientHeight;
      /* 字掉到底時存不進去(別的分頁登出、換帳號、帳號資料夾還沒灌好;held 開「重新整理」卡):先暫停,這個字留在底下、不扣命。
         以前照樣扣命、漏接靜靜不存,最後寫「沒命了，分數 N（新紀錄）」其實什麼都沒存(審查 D 第 1 輪 #5) */
      let stall = false;
      blocks = blocks.filter(b => {
        if (over) return false;
        if (stall) return true;
        b.y += b.speed * dt;
        b.el.style.transform = 'translateY(' + b.y + 'px)';
        if (b.y + b.el.offsetHeight >= H) {
          if (held(input)) { stall = true; return true; }
          miss(b);
          return false;
        }
        return true;
      });
      if (over) return;
      if (stall) { togglePause(); return; }
      rafId = requestAnimationFrame(loop);
    }

    function miss(b) {
      if (over) return;
      b.el.classList.add('missed');
      setTimeout(() => b.el.remove(), 400);
      lives--;
      drawLives();
      combo = 0;
      if (!missedOnce.has(b.answer)) missedThisGame.push({ answer: b.answer, zh: b.zh });
      missedOnce.add(b.answer);
      missPool[b.answer] = (missPool[b.answer] || 0) + 1;
      store.set('vgame_miss', missPool);
      queue.splice(Math.min(2, queue.length), 0, b.item);
      if (lives <= 0) gameOver();
    }

    input.addEventListener('keydown', e => {
      /* 中文輸入法選字中的 Enter 不算送出 */
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key !== 'Enter' || !running || over) return;
      /* 擋下時先暫停,打的字留著。preventDefault:卡片一開焦點就移走,不取消的話同一下 Enter 的 keypress 會落到卡片上按下去(審查 D 第 1 輪 #4) */
      if (held(input)) { e.preventDefault(); togglePause(); return; }
      const raw = input.value.trim();
      const val = norm(raw);
      if (!val) return;
      /* 打中最低(最危險)的那一個 */
      const match = dir === 'e2z'
        ? b => raw === String(b.zh).trim() || zhVariants(b.zh).indexOf(zhKey(raw)) > -1
        : b => norm(b.answer) === val || (sameZh[b.zh] && sameZh[b.zh].has(val));
      const hits = blocks.filter(match).sort((a, b2) => b2.y - a.y);
      if (hits.length) {
        const b = hits[0];
        blocks = blocks.filter(x => x !== b);
        b.el.classList.add('boom');
        setTimeout(() => b.el.remove(), 260);
        combo++;
        score += (dir === 'e2z' ? raw.length * 2 : b.answer.replace(/\s/g, '').length) + (combo >= 5 ? 2 : 0);
        scoreEl.textContent = String(score);
        /* 打對過的字從漏接池移除 */
        if (missPool[b.answer]) {
          delete missPool[b.answer];
          store.set('vgame_miss', missPool);
        }
        if (!missedOnce.has(b.answer)) firstTry++;
        cleared.add(b.answer);
        f.progress(cleared.size);
        input.value = '';
        if (cleared.size === total) setTimeout(roundClear, 300);
      } else {
        combo = 0;
        input.classList.remove('wrong');
        void input.offsetWidth;
        input.classList.add('wrong');
      }
    });

    function togglePause() {
      if (over) return;
      running = !running;
      pauseBtn.textContent = running ? '暫停' : '繼續';
      field.classList.toggle('paused', !running);
      if (running) {
        lastTime = 0;
        rafId = requestAnimationFrame(loop);
        input.focus();
      } else if (rafId) {
        cancelAnimationFrame(rafId);
      }
    }

    /* 關閉鈕確認離開:只停遊戲,不記成績(這一關的字也不算打過) */
    function abandon() {
      over = true;
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    }

    function stopGame() {
      over = true;
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      blocks.forEach(b => b.el.remove());
      blocks = [];
      input.disabled = true;
      pauseBtn.disabled = true;
      /* 打對的字記下來,下一關先出別的字 */
      const log = (doneLog[bestKey] || []).filter(a => !cleared.has(a)).concat([...cleared]).slice(-300);
      doneLog[bestKey] = log;
      if (bestKey.indexOf('+') > 0) trimCombos(doneLog, bestKey);
      store.set('vgame_done', doneLog);
    }

    const srcName = src.name;
    const fmtTime = ms => { const sec = Math.round(ms / 1000); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };

    function gameOver() {
      if (over) return;
      stopGame();
      logAttempt('vq', 'fall', score, false, { q: '掉落消除 ' + srcName + ' · ' + total + ' 字', x: '完成 ' + cleared.size + ' / ' + total + ' · ' + score + ' 分', g: 'fall' });
      const best = store.get('vgame_best', {});
      const isBest = score > (best[bestKey] || 0);
      if (isBest) {
        best[bestKey] = score;
        store.set('vgame_best', best);
      }
      f.leave();
      /* 浮層裡一張緊湊的結算卡。沒命不領點心:這裡不放點心列的東西 */
      const overlay = h('div', { class: 'game-over' });
      field.append(overlay);
      showResult(overlay, {
        compact: true, kicker: '掉落消除 · 沒命了', big: String(score), unit: '分', flag: isBest ? '新紀錄' : '',
        ratio: total ? cleared.size / total : 0,
        stats: [['打對', cleared.size + ' / ' + total]],
        primary: { label: '再做一次', onClick: () => startGame(modes, levelName, speedKey, dir) },
        links: [{ label: '回單字訓練', onClick: renderHome }],
      }, '漏接的字 ' + missedThisGame.length + ' 個', missedThisGame.length ? [wordRows(missedThisGame, false)] : []);
    }

    /* ---------- 通關 ---------- */
    function roundClear() {
      if (over) return;
      stopGame();
      const secs = Math.round(playMs / 1000);
      const best = store.get('vgame_best', {});
      const isBest = score > (best[bestKey] || 0);
      if (isBest) {
        best[bestKey] = score;
        store.set('vgame_best', best);
      }
      const clears = store.get('vgame_clear', {});
      const prev = clears[bestKey] || { n: 0, secs: 0 };
      const fastest = !prev.n || secs < prev.secs;
      clears[bestKey] = { n: prev.n + 1, secs: fastest ? secs : prev.secs };
      store.set('vgame_clear', clears);
      logAttempt('vq', 'fall', score, true, { q: '掉落消除 ' + srcName + ' · ' + total + ' 字', x: '通關 · ' + fmtTime(playMs) + ' · ' + score + ' 分', g: 'fall' });

      const back = [...missedOnce].map(a => roundItems.find(p => p.answer === a)).filter(Boolean);
      const RING = '<svg viewBox="0 0 220 96" aria-hidden="true"><filter id="clrPen" x="-10%" y="-10%" width="120%" height="120%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter>' +
        '<path d="M30 52c-6-26 52-40 104-36c46 4 74 20 70 38c-4 22-60 32-110 30c-44-2-70-12-66-28c2-8 12-14 24-18" fill="none" stroke="#d2443c" stroke-width="3" stroke-linecap="round" filter="url(#clrPen)"/></svg>';
      f.leave();
      const overlay = h('div', { class: 'game-over round-clear' });
      field.append(overlay);
      const times = clears[bestKey].n;
      const card = showResult(overlay, {
        earnId: 'fall',   // 跟掛勾同一個來源 id
        compact: true, big: String(score), unit: '分', flag: isBest ? '新紀錄' : '', pose: 'happy',
        stats: [['用時', fmtTime(playMs) + (fastest && prev.n ? ' 最快' : '')], ['一次打對', firstTry + ' / ' + total]],
        note: (src.live.length > 1 ? '這個組合' : banksOnly ? '這個單字本' : '這個字庫') + '已通關 ' + times + ' 次' + (prev.n && !fastest ? ' · 最快 ' + fmtTime(prev.secs * 1000) : ''),
        primary: { label: '再做一次', onClick: () => startGame(modes, levelName, speedKey, dir) },
        links: [{ label: '回單字訓練', onClick: renderHome }],
      }, '漏接後補回來的字 ' + back.length + ' 個', back.length ? [wordRows(back, false)] : []);
      /* 通關的手繪紅圈:放在分數上面 */
      card.heading.before(h('div', { class: 'clear-mark' }, h('span', { class: 'clear-ring', html: RING }), h('span', { class: 'clear-word' }, '通關')));
      if (window.PET_HOOK) PET_HOOK.done('fall', { into: card.reward });
    }

    rafId = requestAnimationFrame(loop);
  }

  /* ================= 片語特訓 ================= */
  /* 片語結算的「回單字訓練」:先清掉網址的 #phrase,才會回到單字訓練首頁而不是片語清單 */
  function backHome() {
    history.replaceState(null, '', location.pathname + location.search);
    renderHome();
  }
  function startDrill(groupName, items) {
    document.title = '片語特訓 - 衝衝英文';
    const st = store.get('phrase_drill', {});
    /* 錯的與沒做過的優先 */
    const shuffle = arr => {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const fresh = items.filter(p => !st[p.id]);
    const wrong = items.filter(p => st[p.id] && !st[p.id].ok);
    const done = items.filter(p => st[p.id] && st[p.id].ok);
    const list = [...shuffle(fresh), ...shuffle(wrong), ...shuffle(done)].slice(0, 10);
    const results = [];
    let cur = 0;
    /* 專心模式加即時回饋條:答完底部變成「答對」或「答錯 · 正解 …」加「下一題」。第一次作答後關閉才要確認 */
    const f = focusOn(list.length, renderHome, false);
    draw();

    function draw() {
      root.innerHTML = '';
      f.progress(cur + 1);
      f.foot(null);
      drawQuestion(list[cur]);
    }

    /* 詳解方塊底部加「回報題目」(js/report.js);id 是片語 id,跟 logAttempt 的 ph 同一套 */
    function withReport(box, m, id) {
      if (window.REPORT) REPORT.attach(box, { m, id });
      return box;
    }

    function drawQuestion(p) {
      let doneQ = false;
      const result = h('div', null);
      const opts = h('div', { class: 'opts', style: 'margin-top:10px' });
      p.quiz.options.forEach((opt, oi) => {
        opts.append(h('button', {
          class: 'opt',
          onclick: e => {
            if (doneQ || held(e.currentTarget)) return;
            doneQ = true;
            const ok = oi === p.quiz.answer;
            results[cur] = ok;
            const st2 = store.get('phrase_drill', {});
            st2[p.id] = { ok, t: Date.now() };
            store.set('phrase_drill', st2);
            logAttempt('ph', p.id, oi, ok);
            f.dirty(true);
            [...opts.children].forEach((b, bi) => {
              b.disabled = true;
              if (bi === p.quiz.answer) b.classList.add('correct');
              else if (bi === oi) b.classList.add('wrong');
              else b.classList.add('plain');
            });
            const isLast = cur === list.length - 1;
            result.append(
              withReport(h('div', { class: 'explain' }, h('div', null, p.quiz.explanation)), 'ph', p.id),
              h('div', { class: 'phrase-card' },
                h('div', { class: 'pc-head' }, h('b', null, p.phrase), h('span', null, p.zh)),
                p.tip ? h('div', { class: 'pc-tip' }, p.tip) : null,
                h('div', { class: 'pc-ex' }, p.example),
                h('div', { class: 'pc-exzh' }, p.exampleZh)));
            f.feedback({
              ok, answer: LETTERS[p.quiz.answer] + '. ' + p.quiz.options[p.quiz.answer], next: isLast ? '看成績' : '下一題',
              onNext: () => {
                if (isLast) summary();
                else { cur++; draw(); window.scrollTo(0, 0); }
              },
            });
          },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, opt)));
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'vg-tag' }, groupName),
        h('div', { class: 'q-text', style: 'font-size:17px' }, p.quiz.q),
        opts, result));
    }

    function summary() {
      f.leave();
      root.innerHTML = '';
      const ok = results.filter(Boolean).length;
      const card = showResult(root, {
        earnId: 'ph',   // 跟掛勾同一個來源 id
        score: ok, total: list.length, kicker: '片語特訓 · ' + groupName,
        primary: { label: '再做一次', onClick: () => startDrill(groupName, items) },
        links: [{ label: '回單字訓練', onClick: backHome }],
      });
      window.scrollTo(0, 0);
      if (window.PET_HOOK) PET_HOOK.done('ph', { n: list.length, into: card.reward });
    }
  }

  /* ================= 更多玩法:共用工具 ================= */
  function shuffleArr(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  /* 抽 n 個:漏接池裡的字優先(最多一半),其餘隨機。
     uniqZh:中文一樣的字(同事=co-worker、colleague)只放一個。好幾個來源一起練的翻牌用:兩張一樣的中文牌配不起來 */
  function pickN(pool, n, uniqZh) {
    const missPool = store.get('vgame_miss', {});
    const used = new Set();
    const firstOf = (list, max) => {
      const out = [];
      for (const p of list) {
        if (out.length >= max) break;
        if (uniqZh && used.has(p.zh)) continue;
        used.add(p.zh);
        out.push(p);
      }
      return out;
    };
    const missed = firstOf(shuffleArr(pool.filter(p => missPool[p.answer])), Math.floor(n / 2));
    const rest = firstOf(shuffleArr(pool.filter(p => !missed.includes(p))), n - missed.length);
    return shuffleArr([...missed, ...rest]);
  }
  /* 干擾選項:先從 prefer(同一盤的字)挑,不夠再從整個字池補;中英都不能與正解相同 */
  function distractors(pool, item, n, prefer) {
    const diff = p => p.answer !== item.answer && p.zh !== item.zh;
    const first = shuffleArr((prefer || []).filter(diff));
    const more = shuffleArr(pool.filter(p => diff(p) && !first.includes(p)));
    return [...first, ...more].slice(0, n);
  }
  function markMiss(item, ok) {
    const missPool = store.get('vgame_miss', {});
    if (ok) {
      if (!missPool[item.answer]) return;
      delete missPool[item.answer];
    } else missPool[item.answer] = (missPool[item.answer] || 0) + 1;
    store.set('vgame_miss', missPool);
  }
  /* 遊戲的標題列:專心模式裡沒有「回單字訓練」連結,離開用頂端的關閉鈕 */
  function gameTop(title, sub) {
    return h('div', { class: 'drill-top' },
      h('h1', null, title + ' ', h('span', { style: 'font-size:13.5px;color:var(--ink-light);font-weight:400' }, sub)));
  }
  function tooSmall(pool, min) {
    if (pool.length >= min) return false;
    /* 別的分頁剛刪了單字本才會碰到(首頁磚已經擋掉字不夠的情況):站內通知視窗,回單字訓練首頁 */
    renderHome();
    if (window.UI && typeof UI.alert === 'function') UI.alert({ title: '字不夠', body: '要 ' + min + ' 個以上' });
    return true;
  }

  /* ================= 翻牌配對 ================= */
  function startPairs(modes, levelName) {
    const src = srcPool(modes, levelName);
    const { pool, name } = src;
    if (tooSmall(pool, MIN_WORDS.pairs)) return;
    let items = pickN(pool, Math.min(8, pool.length), src.live.length > 1);
    if (items.length < MIN_WORDS.pairs) items = pickN(pool, Math.min(8, pool.length));   // 中文幾乎都一樣(不該發生):照舊抽
    document.title = '翻牌配對 - 衝衝英文';
    root.innerHTML = '';
    const cards = shuffleArr(items.flatMap((it, i) => [{ k: i, face: it.answer, en: true }, { k: i, face: it.zh, en: false }]));
    let first = null, lock = false, moves = 0, matched = 0, startT = 0, timer = null;
    const movesEl = h('span', { class: 'hud-score' }, '0');
    const timeEl = h('span', { class: 'hud-score' }, '0');
    const grid = h('div', { class: 'mem-grid' });
    /* 進行中:藏導覽,頂端是關閉鈕與進度(配對幾對 / 共幾對);底部列留空 */
    const f = focusOn(items.length, () => { clearInterval(timer); renderHome(); });
    root.append(gameTop('翻牌配對', name + ' · ' + items.length + ' 對'),
      h('div', { class: 'game-hud' }, h('span', null, '步數 ', movesEl), h('span', null, '秒數 ', timeEl)),
      grid);
    cards.forEach(c => {
      c.el = h('button', { class: 'mem-card' + (c.en ? '' : ' zh'), type: 'button', onclick: e => { if (!held(e.currentTarget)) flip(c); } }, '?');
      grid.append(c.el);
    });
    const tick = () => { timeEl.textContent = String(Math.round((Date.now() - startT) / 1000)); };
    function flip(c) {
      if (lock || c.done || c === first) return;
      if (!startT) { startT = Date.now(); timer = setInterval(tick, 500); }
      c.el.classList.add('flipped');
      c.el.textContent = c.face;
      if (!first) { first = c; return; }
      moves++;
      movesEl.textContent = String(moves);
      if (first.k === c.k) {
        first.done = c.done = true;
        first.el.classList.add('matched');
        c.el.classList.add('matched');
        first = null;
        matched++;
        f.progress(matched);
        if (matched === items.length) finish();
        return;
      }
      lock = true;
      const a = first;
      first = null;
      setTimeout(() => {
        [a, c].forEach(x => { x.el.classList.remove('flipped'); x.el.textContent = '?'; });
        lock = false;
      }, 850);
    }
    function finish() {
      clearInterval(timer);
      tick();
      const secs = Math.round((Date.now() - startT) / 1000);
      const key = src.key + ':' + items.length;
      const best = store.get('vgame_pairs_best', {});
      const prev = best[key];
      const isBest = !prev || moves < prev.moves || (moves === prev.moves && secs < prev.secs);
      if (isBest) { best[key] = { moves, secs }; store.set('vgame_pairs_best', best); }
      logAttempt('vq', 'pairs', moves, true, { q: '翻牌配對 ' + name + '：' + items.length + ' 對', x: moves + ' 步 · ' + secs + ' 秒', g: 'pairs' });
      f.leave();
      root.innerHTML = '';
      const card = showResult(root, {
        earnId: 'pairs',   // 跟掛勾同一個來源 id
        big: String(moves), unit: '步', kicker: '翻牌配對 · ' + items.length + ' 對', flag: isBest ? '新紀錄' : '', pose: 'happy',
        stats: [['用時', secs + ' 秒']],
        note: prev && !isBest ? '最佳紀錄 ' + prev.moves + ' 步 · ' + prev.secs + ' 秒' : '',
        primary: { label: '再做一次', onClick: () => startPairs(modes, levelName) },
        links: [{ label: '回單字訓練', onClick: renderHome }],
      });
      window.scrollTo(0, 0);
      if (window.PET_HOOK) PET_HOOK.done('pairs', { into: card.reward });
    }
  }

  /* ================= 記憶吐司:限時記 6 個字,烤好後逐題考意思 ================= */
  function startToast(modes, levelName) {
    const src = srcPool(modes, levelName);
    const { pool, name } = src;
    if (tooSmall(pool, MIN_WORDS.toast)) return;
    const items = pickN(pool, Math.min(6, pool.length));
    const SHOW_MS = 15000;
    document.title = '記憶吐司 - 衝衝英文';
    root.innerHTML = '';
    const bar = h('i', { style: 'width:100%' });
    const grid = h('div', { class: 'toast-grid' },
      items.map(it => h('div', { class: 'toast-card' }, h('b', null, it.answer), h('span', null, it.zh))));
    let iv = null;
    /* 進行中:藏導覽,頂端是關閉鈕與進度(考到第幾題 / 共幾題);記字的 15 秒是 0。這是遊戲,底部列留空,考題的「下一題」放在選項下面 */
    const f = focusOn(items.length, () => { clearInterval(iv); renderHome(); });
    root.append(gameTop('記憶吐司', name),
      h('p', { class: 'result-note' }, '記住這 ' + items.length + ' 個字 · 15 秒後開考'),
      h('div', { class: 'toast-timer' }, bar), grid,
      h('div', { class: 'drill-nav-btns' }, h('button', { class: 'btn primary', type: 'button', onclick: () => quiz() }, '直接開考')));
    const t0 = Date.now();
    iv = setInterval(() => {
      const left = Math.max(0, SHOW_MS - (Date.now() - t0));
      bar.style.width = (left / SHOW_MS * 100) + '%';
      if (!left) quiz();
    }, 100);
    let started = false;

    function quiz() {
      if (started) return;
      started = true;
      clearInterval(iv);
      const order = shuffleArr(items);
      const results = [];
      let cur = 0;
      draw();

      function draw() {
        root.innerHTML = '';
        f.progress(cur + 1);
        const it = order[cur];
        const opts = shuffleArr([it, ...distractors(pool, it, 3, items)]);
        const ai = opts.indexOf(it);
        let done = false;
        const optsEl = h('div', { class: 'opts', style: 'margin-top:10px' });
        const after = h('div', null);
        opts.forEach((o, oi) => {
          optsEl.append(h('button', {
            class: 'opt',
            onclick: e => {
              if (done || held(e.currentTarget)) return;
              done = true;
              const ok = oi === ai;
              results.push({ it, ok });
              markMiss(it, ok);
              logAttempt('vq', it.answer, oi, ok, { q: it.answer, o: opts.map(x => x.zh), a: ai, g: 'toast' });
              [...optsEl.children].forEach((b, bi) => {
                b.disabled = true;
                b.classList.add(bi === ai ? 'correct' : bi === oi ? 'wrong' : 'plain');
              });
              const isLast = cur === order.length - 1;
              /* 「看成績」要存最佳紀錄:答完最後一題才擋下的話,跳卡、不出成績(以前照樣寫「（新紀錄）」卻沒存;審查 D 第 1 輪 #5) */
              after.append(h('div', { class: 'vg-next-row' },
                h('button', { class: 'btn primary', type: 'button', onclick: e2 => { if (!isLast) { cur++; draw(); } else if (!held(e2.currentTarget)) summary(); } },
                  isLast ? '看成績' : '下一題')));
            },
          }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, o.zh)));
        });
        root.append(h('div', { class: 'q-block' },
          h('div', { class: 'vg-tag' }, '記憶吐司'),
          h('div', { class: 'toast-stem' }, it.answer),
          optsEl, after));
      }

      function summary() {
        f.leave();
        root.innerHTML = '';
        const okN = results.filter(r => r.ok).length;
        const best = store.get('vgame_toast_best', {});
        const isBest = okN > (best[src.key] || 0);
        if (isBest) { best[src.key] = okN; store.set('vgame_toast_best', best); }
        const card = showResult(root, {
          earnId: 'toast',   // 跟掛勾同一個來源 id
          score: okN, total: results.length, kicker: '記憶吐司', flag: isBest && okN ? '新紀錄' : '',
          primary: { label: '再做一次', onClick: () => startToast(modes, levelName) },
          links: [{ label: '回單字訓練', onClick: renderHome }],
        }, '逐字結果 ' + results.length + ' 個', [wordRows(results.map(r => ({ answer: r.it.answer, zh: r.it.zh, ok: r.ok })), true)], results.length - okN);
        window.scrollTo(0, 0);
        if (window.PET_HOOK) PET_HOOK.done('toast', { n: results.length, into: card.reward });
      }
    }
  }

  /* ================= 單字選擇題 ================= */
  function startMcq(modes, levelName, dir) {
    dir = dir === 'z2e' ? 'z2e' : 'e2z';
    const { pool, name } = srcPool(modes, levelName);
    if (tooSmall(pool, MIN_WORDS.mcq)) return;
    const list = pickN(pool, Math.min(10, pool.length));
    const results = [];
    let cur = 0;
    document.title = '單字選擇題 - 衝衝英文';
    const face = o => (dir === 'e2z' ? o.zh : o.answer);
    /* 專心模式加即時回饋條。第一次作答後關閉才要確認 */
    const f = focusOn(list.length, renderHome, false);
    draw();

    function draw() {
      root.innerHTML = '';
      f.progress(cur + 1);
      f.foot(null);
      const it = list[cur];
      const opts = shuffleArr([it, ...distractors(pool, it, 3)]);
      const ai = opts.indexOf(it);
      const stem = dir === 'e2z' ? it.answer : it.zh;
      let done = false;
      const optsEl = h('div', { class: 'opts', style: 'margin-top:10px' });
      const after = h('div', null);
      opts.forEach((o, oi) => {
        optsEl.append(h('button', {
          class: 'opt',
          onclick: e => {
            if (done || held(e.currentTarget)) return;
            done = true;
            const ok = oi === ai;
            results[cur] = ok;
            markMiss(it, ok);
            logAttempt('vq', it.answer, oi, ok, { q: stem, o: opts.map(face), a: ai, g: 'mcq' });
            f.dirty(true);
            [...optsEl.children].forEach((b, bi) => {
              b.disabled = true;
              b.classList.add(bi === ai ? 'correct' : bi === oi ? 'wrong' : 'plain');
            });
            const isLast = cur === list.length - 1;
            after.append(h('div', { class: 'explain' }, h('b', null, it.answer), ' ', h('span', null, it.zh)));
            f.feedback({
              ok, answer: LETTERS[ai] + '. ' + face(it), next: isLast ? '看成績' : '下一題',
              onNext: () => { if (isLast) summary(); else { cur++; draw(); window.scrollTo(0, 0); } },
            });
          },
        }, h('span', { class: 'letter' }, LETTERS[oi]), h('span', null, face(o))));
      });
      root.append(h('div', { class: 'q-block' },
        h('div', { class: 'vg-tag' }, name + ' · ' + (dir === 'e2z' ? '看英文選中文' : '看中文選英文')),
        h('div', { class: 'toast-stem' }, stem),
        optsEl, after));
    }

    function summary() {
      f.leave();
      root.innerHTML = '';
      const okN = results.filter(Boolean).length;
      const wrong = list.filter((x, i) => !results[i]);
      const card = showResult(root, {
        earnId: 'mcq',   // 跟掛勾同一個來源 id
        score: okN, total: list.length, kicker: '單字選擇題',
        primary: { label: '再做一次', onClick: () => startMcq(modes, levelName, dir) },
        links: [{ label: '回單字訓練', onClick: renderHome }],
      }, '答錯的字 ' + wrong.length + ' 個', wrong.length ? [wordRows(wrong.map(x => ({ answer: x.answer, zh: x.zh, ok: false })), true)] : []);
      window.scrollTo(0, 0);
      if (window.PET_HOOK) PET_HOOK.done('mcq', { n: list.length, into: card.reward });
    }
  }
})();
