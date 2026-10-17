/* 刷刷英文:安裝後的 App 外殼、安裝入口、service worker 註冊(2026-10)
   網站模式只做兩件事:提供 window.APP(頭像選單的「安裝到手機」)與註冊 /sw.js。
   主畫面開啟時(head 開機程式已在 <html> 加 is-app、app-shell)才建返回鍵、分頁列、捲動小標題、鍵盤偵測。
   不依賴 common.js(terms.html 沒載入它)。不讀寫任何瀏覽器端儲存,不碰 Supabase(只讀 CLOUD.user)。
   圖示路徑改自 Lucide(ISC License,https://lucide.dev)。 */
(function () {
  'use strict';
  const doc = document;
  const html = doc.documentElement;
  const STANDALONE = html.classList.contains('is-app');
  const SW_ON = true;          // 緊急退路:改成 false,並把 sw.js 整份換成 tools/sw-killswitch.js
  const IOS_INSTALL = 'off';   // 'off' | 'password-only' | 'on'。她用 iPhone 實測主畫面 App 的 Google 登入前維持 'off'
  const TITLE_AFTER = 64;      // 捲超過這個高度,頂欄才淡入頁名
  const KB_MIN = 120;          // visualViewport 縮小超過這個高度才算鍵盤打開

  const TABS = [
    { key: 'home', label: '首頁', href: 'index.html', pages: ['index.html', 'diagnostic.html', 'daily.html'] },
    { key: 'learn', label: '學習', href: 'learn.html', pages: ['learn.html', 'grammar.html', 'phonics.html', 'tenses.html', 'verbs.html', 'vocab.html', 'listening.html', 'reading.html', 'dialogue.html', 'writing.html'] },
    { key: 'drill', label: '刷題', href: 'drill.html', pages: ['drill.html', 'practice.html', 'mock.html'] },
    { key: 'review', label: '複習', href: 'review.html', pages: ['review.html'] },
    { key: 'me', label: '我的', href: 'me.html', pages: ['me.html', 'history.html', 'analysis.html', 'admin.html'] },
  ];
  const TITLES = {
    'diagnostic.html': '程度檢測', 'daily.html': '每日練習', 'grammar.html': '文法基礎', 'phonics.html': '自然發音', 'verbs.html': '不規則動詞', 'vocab.html': '單字訓練',
    'listening.html': '聽力訓練', 'reading.html': '閱讀訓練', 'dialogue.html': '對話練習', 'tenses.html': '時態總整理', 'writing.html': '寫作練習', 'practice.html': '題庫刷題',
    'mock.html': '模擬考', 'history.html': '學習記錄', 'analysis.html': '能力分析', 'admin.html': '教師後台', 'pricing.html': '方案與價格',
    'terms.html': '服務條款', 'privacy.html': '隱私權政策', 'refund.html': '退款政策', 'pay-result.html': '付款結果',
  };
  const PAGE = (function () {
    let p = location.pathname.split('/').pop() || 'index.html';
    if (p.indexOf('.') < 0) p += '.html';
    return p;
  })();

  const UA = navigator.userAgent || '';
  const IS_IOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const IN_APP = UA.indexOf('Line/') > -1 || /FBAN|FBAV|Instagram/.test(UA);
  const IOS_SAFARI = IS_IOS && !IN_APP && UA.indexOf('Safari/') > -1 && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA/.test(UA);
  /* iOS 26 的 UA 把系統版本凍結在 18_6,要看 Safari 的 Version/ 主版本 */
  const SAFARI_MAJOR = (function () { const i = UA.indexOf('Version/'); return i > -1 ? (parseInt(UA.slice(i + 8), 10) || 0) : 0; })();

  const SVG = "<svg viewBox='0 0 24 24' width='24' height='24' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>";
  const ICONS = {
    home: {
      o: "<path d='M3 10a2 2 0 0 1 .7-1.53l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/><path d='M9 21v-7a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7'/>",
      f: "<path fill='currentColor' d='M3 10a2 2 0 0 1 .7-1.53l7-6a2 2 0 0 1 2.6 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'/><rect x='9.75' y='13.75' width='4.5' height='8.5' rx='1' fill='#fff' stroke='none'/>",
    },
    learn: {
      o: "<path d='M12 7v14'/><path d='M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'/>",
      f: "<path fill='currentColor' d='M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z'/><path d='M12 8v11' stroke='#fff'/>",
    },
    drill: {
      o: "<rect x='8' y='2' width='8' height='4' rx='1'/><path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/><path d='m9 14 2 2 4-4'/>",
      f: "<path fill='currentColor' d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2'/><rect x='8' y='2' width='8' height='4' rx='1' fill='currentColor' stroke='#fff' stroke-width='1.5'/><path d='m9 14 2 2 4-4' stroke='#fff'/>",
    },
    review: {
      o: "<path d='M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'/><path d='M3 3v5h5'/>",
      f: "<circle cx='12' cy='12' r='10' fill='currentColor' stroke='none'/><path d='M7 12a5 5 0 1 0 5-5 5.4 5.4 0 0 0-3.74 1.52L7 9.78' stroke='#fff'/><path d='M7 7v2.78h2.78' stroke='#fff'/>",
    },
    me: {
      o: "<circle cx='12' cy='7' r='4'/><path d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'/>",
      f: "<circle cx='12' cy='7' r='4' fill='currentColor'/><path fill='currentColor' d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2z'/>",
    },
  };
  const CHEVRON = SVG.replace("stroke-width='1.8'", "stroke-width='2'") + "<path d='m15 18-6-6 6-6'/></svg>";
  const SHARE = "<svg viewBox='0 0 24 24' width='18' height='18' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'/><path d='m16 6-4-4-4 4'/><path d='M12 2v13'/></svg>";
  const X_ICON = "<svg viewBox='0 0 22 22' width='18' height='18' aria-hidden='true' focusable='false' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'><path d='M5 5 17 17M17 5 5 17'/></svg>";

  /* innerHTML 只放本檔寫死的 SVG 與文字,不放任何外部資料 */
  function el(tag, attrs, inner) {
    const n = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (inner) n.innerHTML = inner;
    return n;
  }
  function mq(q) { try { return window.matchMedia(q).matches; } catch (e) { return false; } }
  function tabOf(page) { return TABS.filter(function (t) { return t.pages.indexOf(page) > -1; })[0] || null; }

  /* ---------- 安裝入口(網站頭像選單用) ---------- */
  function iosAllowed() {
    if (!IOS_SAFARI || IOS_INSTALL === 'off') return false;
    const C = window.CLOUD;
    if (!C || !C.enabled || !C.user) return false;     // 訪客在 Safari 的進度帶不進主畫面 App,不給
    if (IOS_INSTALL === 'password-only') {
      const prov = (C.user.app_metadata && C.user.app_metadata.providers) || [];
      if (prov.indexOf('email') < 0) return false;      // 只用 Google 登入的帳號先不給
    }
    return true;
  }
  function canOfferInstall() {
    if (STANDALONE || IN_APP || !mq('(pointer: coarse)')) return false;
    return !!window.__bip || iosAllowed();
  }
  function install() {
    const e = window.__bip;
    if (e) {
      window.__bip = null;                               // prompt() 每個事件只能用一次
      /* prompt() 回傳 Promise,失敗多半是非同步 reject,try/catch 接不到,要另外 catch */
      try {
        const p = e.prompt();
        if (p && p.catch) p.catch(function (err) { console.warn('安裝視窗打不開：', err); });
      } catch (err) { console.warn('安裝視窗打不開：', err); return; }
      if (e.userChoice) e.userChoice.catch(function () {});
      return;
    }
    if (iosAllowed()) showInstallHelp();
  }
  function showInstallHelp() {
    if (doc.querySelector('.modal-mask')) return;
    const steps = SAFARI_MAJOR >= 26
      ? [['點網址列旁的「⋯」'], ['點「分享」'], ['往下滑，點「加入主畫面」'], ['點「加入」']]
      : [['點分享按鈕', SHARE], ['往下滑，點「加入主畫面」'], ['點「加入」']];
    const mask = el('div', { class: 'modal-mask' });
    const box = el('div', { class: 'modal app-install', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'app-install-h' });
    const x = el('button', { class: 'modal-close', type: 'button', 'aria-label': '關閉' }, X_ICON);
    const title = el('h2', { class: 'auth-h', id: 'app-install-h' });
    title.textContent = '安裝到手機';
    const ol = el('ol', { class: 'app-steps' });
    steps.forEach(function (s) {
      const li = el('li');
      li.textContent = s[0];
      if (s[1]) li.appendChild(el('span', { class: 'app-share' }, s[1]));
      ol.appendChild(li);
    });
    const note = el('p', { class: 'app-install-note' });
    note.textContent = '從主畫面打開後要再登入一次。';
    box.append(x, title, ol, note);
    mask.appendChild(box);
    doc.body.appendChild(mask);
    function onKey(e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'Tab') { e.preventDefault(); x.focus(); }   // 視窗裡只有關閉鈕可聚焦
    }
    function close() {
      doc.removeEventListener('keydown', onKey);
      mask.remove();
      const back = doc.querySelector('.profile-btn');
      if (back) back.focus();
    }
    x.addEventListener('click', close);
    mask.addEventListener('mousedown', function (e) { if (e.target === mask) close(); });
    doc.addEventListener('keydown', onKey);
    x.focus();
  }

  /* ---------- App 外殼(只在主畫面開啟時) ---------- */
  function okToLeave() {
    const msg = doc.body && doc.body.dataset.leaveConfirm;
    return !msg || window.confirm(msg);
  }
  function goBack() {
    if (!okToLeave()) return;
    let same = false;
    try { same = !!doc.referrer && new URL(doc.referrer).origin === location.origin; } catch (e) { same = false; }
    if (same && history.length > 1) { history.back(); return; }
    const t = tabOf(PAGE);
    location.href = t ? t.href : 'index.html';
  }
  function tabIcon(key) {
    return SVG + "<g class='ico-o'>" + ICONS[key].o + "</g><g class='ico-f'>" + ICONS[key].f + '</g></svg>';
  }
  function buildTabbar(cur, isRoot) {
    const nav = el('nav', { class: 'app-tabbar', 'aria-label': '主要分頁' });
    TABS.forEach(function (t) {
      const a = el('a', { class: 'app-tab', href: t.href }, tabIcon(t.key) + '<span>' + t.label + '</span>');
      if (t === cur) { a.classList.add('on'); a.setAttribute('aria-current', isRoot ? 'page' : 'true'); }
      a.addEventListener('click', function (e) {
        if (t === cur && isRoot) {
          e.preventDefault();
          try { window.scrollTo({ top: 0, behavior: mq('(prefers-reduced-motion: reduce)') ? 'auto' : 'smooth' }); }
          catch (err) { window.scrollTo(0, 0); }
          return;
        }
        if (!okToLeave()) e.preventDefault();
      });
      nav.appendChild(a);
    });
    return nav;
  }
  function buildTopbar(isRoot) {
    const inner = doc.querySelector('.topbar-inner');
    if (!inner || isRoot) return;
    const back = el('button', { class: 'app-back', type: 'button', 'aria-label': '返回' }, CHEVRON);
    back.addEventListener('click', goBack);
    inner.insertBefore(back, inner.firstChild);
    if (html.classList.contains('has-tabbar') && TITLES[PAGE]) {
      const t = el('span', { class: 'app-title', 'aria-hidden': 'true' });
      t.textContent = TITLES[PAGE];
      inner.appendChild(t);
    }
  }
  function syncScrolled() {
    const bar = doc.querySelector('.topbar');
    if (bar) bar.classList.toggle('is-scrolled', (window.pageYOffset || 0) > TITLE_AFTER);
  }
  function wireScroll() {
    let ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; syncScrolled(); });
    }, { passive: true });
    syncScrolled();
  }
  function isTextField(n) {
    if (!n) return false;
    if (n.isContentEditable || n.tagName === 'TEXTAREA') return true;
    return n.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|file|color|image|hidden)$/i.test(n.type || '');
  }
  /* 只看焦點不夠:頁面程式 focus 輸入框時 iOS 不跳鍵盤,要再確認可視區真的被鍵盤縮小 */
  function syncKb() {
    const vv = window.visualViewport;
    const up = !!vv && isTextField(doc.activeElement) && (window.innerHeight - vv.height) > KB_MIN;
    html.classList.toggle('app-kb', up);
  }
  function wireKeyboard() {
    doc.addEventListener('focusin', syncKb);
    doc.addEventListener('focusout', function () { setTimeout(syncKb, 0); });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', syncKb);
  }
  function buildShell() {
    const isRoot = html.classList.contains('is-tab-root');
    buildTopbar(isRoot);
    if (html.classList.contains('has-tabbar')) doc.body.appendChild(buildTabbar(tabOf(PAGE), isRoot));
    wireScroll();
    wireKeyboard();
    window.addEventListener('pageshow', function () { syncKb(); syncScrolled(); });   // bfcache 回來時重新對齊
  }

  /* ---------- service worker ---------- */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
      if (!SW_ON) {
        /* 頁面這邊常比瀏覽器檢查 sw.js 更早動手,所以 ss- 快取也在這裡清;只碰 ss- 開頭,學生進度不在快取裡 */
        navigator.serviceWorker.getRegistrations()
          .then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); })
          .then(function () { return window.caches ? caches.keys() : []; })
          .then(function (names) {
            return Promise.all(names.filter(function (n) { return n.indexOf('ss-') === 0; })
              .map(function (n) { return caches.delete(n); }));
          })
          .catch(function (err) { console.warn('service worker 註銷失敗：', err); });
        return;
      }
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(function (reg) {
        /* iOS 主畫面 App 多半是「凍結再喚醒」,不會重新啟動,回到前景時主動檢查新版 */
        doc.addEventListener('visibilitychange', function () {
          if (doc.visibilityState === 'visible') reg.update().catch(function () {});
        });
      }).catch(function (err) { console.warn('service worker 註冊失敗：', err); });
    });
  }

  /* ---------- 分頁列上的小雞(js/pet-roam.js;第二階段 PET_ROAM_V2 開著時換成 js/pet-roam2.js) ----------
     只在有分頁列、而且載入了 common.js 與 cloud.js 的頁面(條款、價格頁沒有)。先載開關 pet-config.js,開著才載其他的;
     頁面上已經有的(首頁與「我的」頁網站模式就有的那幾個、每個載入 cloud.js 的頁面都有的 pet.js)不重載。照順序執行(async = false)。
     第二階段(小雞第二階段規格、實作契約第 11 節):PET_FOOD 開著時多載 pet-food.js(pet.js 後)、pet-hook.js(pet-store.js 後)、
     food-art.js(pet-ui.js 前)。網站模式只在開關打開時才動作(loadWebPet),兩個都關著時一個檔都不多載。 */
  function on(name) { return window[name] === true; }
  function hasGlobal(name) {
    if (name === 'PET.earn') return !!window.PET && typeof window.PET.earn === 'function';
    return !!window[name];
  }
  function loadList(list) {
    list.forEach(function (x) { if (!hasGlobal(x[0])) addScript(x[1]).catch(function (err) { console.warn('小雞載入失敗：', err); }); });
  }
  /* App 模式(有分頁列的頁面):兩個開關都關著時跟第一階段的清單、順序完全一樣 */
  function appPetList() {
    const food = on('PET_FOOD');
    const list = [['PET', 'js/pet.js']];
    if (food) list.push(['PET.earn', 'js/pet-food.js']);
    list.push(['PET_STORE', 'js/pet-store.js']);
    if (food) list.push(['PET_HOOK', 'js/pet-hook.js']);
    list.push(['ChickArt', 'js/chick-art.js']);
    if (food) list.push(['FoodArt', 'js/food-art.js']);
    list.push(['PET_UI', 'js/pet-ui.js']);
    list.push(['PET_ROAM', on('PET_ROAM_V2') ? 'js/pet-roam2.js' : 'js/pet-roam.js']);
    return list;
  }
  /* 網站模式(實作契約第 7.3 節):練習頁在 PET_FOOD 時載入補券和結束畫面那一行要的檔;
     學習、刷題、複習在 PET_ROAM_V2 時載入走動的小雞和面板;首頁、「我的」本來就有面板,只多載 pet-roam2.js */
  const WEB_FOOD_PAGES = ['daily.html', 'grammar.html', 'phonics.html', 'vocab.html', 'reading.html', 'practice.html', 'listening.html',
    'review.html', 'dialogue.html', 'mock.html', 'diagnostic.html', 'writing.html'];
  const WEB_ROAM_FULL = ['learn.html', 'drill.html', 'review.html'];
  const WEB_ROAM_ONLY = ['index.html', 'me.html'];
  function webPetList(page) {
    const food = on('PET_FOOD'), roam2 = on('PET_ROAM_V2');
    const hook = food && WEB_FOOD_PAGES.indexOf(page) > -1;
    const full = roam2 && WEB_ROAM_FULL.indexOf(page) > -1;
    const list = [];
    if (!hook && !full) {
      if (roam2 && WEB_ROAM_ONLY.indexOf(page) > -1) list.push(['PET_ROAM', 'js/pet-roam2.js']);
      return list;
    }
    list.push(['PET', 'js/pet.js']);
    if (food) list.push(['PET.earn', 'js/pet-food.js']);
    list.push(['PET_STORE', 'js/pet-store.js']);
    if (hook) list.push(['PET_HOOK', 'js/pet-hook.js']);
    if (full) {
      list.push(['ChickArt', 'js/chick-art.js']);
      if (food) list.push(['FoodArt', 'js/food-art.js']);
      list.push(['PET_UI', 'js/pet-ui.js'], ['PET_ROAM', 'js/pet-roam2.js']);
    }
    return list;
  }
  function loadWebPet() {
    if (!on('PET_FOOD') && !on('PET_ROAM_V2')) return;
    if (typeof window.storageKey !== 'function' || !window.CLOUD || !petWanted()) return;
    loadList(webPetList(PAGE));
  }
  function addScript(src) {
    return new Promise(function (resolve, reject) {
      const s = doc.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = function () { reject(new Error(src + ' 載入失敗')); };
      doc.body.appendChild(s);
    });
  }
  function petWanted() {
    if (window.PET_ON === true) return true;
    try { return new URLSearchParams(location.search).get('pet') === '1'; } catch (e) { return false; }
  }
  function loadPet() {
    if (!doc.querySelector('.app-tabbar') || typeof window.storageKey !== 'function' || !window.CLOUD) return;
    const first = window.PET_ON === undefined ? addScript('js/pet-config.js') : Promise.resolve();
    first.then(function () {
      if (!petWanted()) return;
      loadList(appPetList());
    }).catch(function (err) { console.warn('小雞載入失敗：', err); });
  }

  window.APP = { standalone: STANDALONE, canOfferInstall: canOfferInstall, install: install };
  if (STANDALONE) {
    doc.addEventListener('touchstart', function () {}, { passive: true });   // iOS 要有觸控監聽,分頁和返回鍵的 :active 按下效果才會出現
    try { buildShell(); }
    catch (err) { html.classList.remove('app-shell'); console.warn('App 外殼建立失敗，改用網站版面：', err); }
    window.APP_SHELL_OK = true;
    try { loadPet(); } catch (err) { console.warn('小雞載入失敗：', err); }
  } else {
    try { loadWebPet(); } catch (err) { console.warn('小雞載入失敗：', err); }
  }
  registerSW();
})();
