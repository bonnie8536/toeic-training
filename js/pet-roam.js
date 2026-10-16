/* App 分頁列上的小雞(路線圖 1.3;Bonnie 10/12:「讓小雞可以在整個 TAB BAR 上跑，但不要蓋到按鈕」)。
   - 腳踩在分頁列上緣,在整條分頁列上方走、跑、停下來,走到兩端轉身。
     小雞走的那一條(51px)是白底、跟分頁列連在一起,頁面內容捲到那裡就被擋住、點不到,跟捲到分頁列底下一樣;
     所以小雞不會蓋到分頁按鈕,也不會蓋到頁面上的按鈕(10/16 審查:透明的那一條會讓小雞走過頁面按鈕時搶走點按)。
     <html> 加 has-pet,CSS 把頁面底部多留這一條的高度,頁面最後的內容和按鈕捲得到它上面。
   - 晚上 11 點到早上 7 點睡覺(不走);今天還沒餵、也還沒達標時大多攤著肚子餓;餵完吃東西再跳一下。
   - 點一下或鍵盤按下去打開餵食面板(js/pet-ui.js);滑鼠移上去、鍵盤焦點在牠身上(看得到焦點框時)停下來不走。
     關掉面板時焦點回到小雞身上:用手指點的看不到焦點框,不停(不然要點別的地方牠才會再走)。
   - 只在看得到時動(畫面上、分頁在前景、面板沒開);減少動態時停在中間、只畫一張靜止的。
   由 js/app-shell.js 在主畫面 App、有分頁列的頁面載入,不讀寫任何儲存。 */
(function () {
  'use strict';
  const U = window.PET_UI, A = window.ChickArt;
  if (!U || !A || typeof h !== 'function') return;
  const doc = document, html = doc.documentElement;
  const SIZE = 48;                       // 畫布寬(CSS 像素)
  const TURN_TICKS = 8;                  // 走到邊停幾拍再轉身

  function rand(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  function build() {
    const bar = doc.querySelector('.app-tabbar');
    if (!bar || !html.classList.contains('app-shell') || doc.querySelector('.pet-roam')) return;
    const M = A.metrics;
    const tall = SIZE * M.height / M.width;
    const below = tall * (M.height - M.ground) / M.height;   // 腳底下面那一小段(透明),伸進分頁列但不接受點擊
    const wrap = h('div', { class: 'pet-roam' });
    const btn = h('button', { class: 'pet-roamer', type: 'button', 'aria-haspopup': 'dialog' });
    const cv = h('canvas', { class: 'pet-roam-cv' });
    cv.style.bottom = (-below).toFixed(1) + 'px';
    btn.append(cv);
    const lane = h('div', { class: 'pet-roam-lane' });   // 扣掉兩側安全區的那一段,小雞在這裡面走
    lane.append(btn);
    wrap.append(lane);
    bar.before(wrap);
    html.classList.add('has-pet');

    let x = 0, dir = Math.random() < 0.5 ? 1 : -1, act = null, turning = 0, held = 0, sheetOpen = false, placed = false;
    const room = () => Math.max(0, lane.clientWidth - SIZE);
    function place() {
      btn.style.transform = 'translateX(' + Math.round(x) + 'px)';
      cv.classList.toggle('is-left', dir < 0);
    }
    /* 下一段要做什麼:睡覺就一直睡;肚子餓多半攤著、偶爾走一小段;其他時候走、跑、停一下 */
    function next() {
      const m = U.mood();
      const r = Math.random();
      if (m === 'sleep') act = { pose: 'sleep', left: Infinity };
      else if (m === 'hungry') act = r < 0.65 ? { pose: 'hungry', left: rand(30, 60) } : { pose: 'walk', left: rand(10, 20) };
      else if (r < 0.35) act = { pose: 'idle', left: rand(16, 32) };
      else if (r < 0.85) act = { pose: 'walk', left: rand(20, 48) };
      else act = { pose: 'run', left: rand(12, 24) };
      if ((act.pose === 'walk' || act.pose === 'run') && Math.random() < 0.3) dir = -dir;
      c.setBase(still() ? m : act.pose);
      place();
    }
    function still() { return held > 0 || sheetOpen || U.reduced; }
    function onTick(t) {
      if (still()) return;
      if (turning > 0) {
        if (--turning === 0) { dir = -dir; place(); c.setBase(act.pose); }
        return;
      }
      if (t.pose === 'walk' || t.pose === 'run') {
        x += dir * t.travel;
        const max = room();
        if (x <= 0 || x >= max) {
          x = Math.max(0, Math.min(max, x));
          turning = TURN_TICKS;
          c.setBase(U.mood() === 'hungry' ? 'hungry' : 'idle');
        }
        place();
      }
      if (act && --act.left <= 0) next();
    }
    const c = U.chick(cv, SIZE, onTick);

    /* 滑鼠在牠身上、鍵盤焦點在牠身上:分開記,兩個都沒有才再走 */
    let hovered = false, focused = false;
    function focusShown() { try { return btn.matches(':focus-visible'); } catch (e) { return false; } }
    function pause() {
      const was = held > 0;
      held = hovered || focused ? 1 : 0;
      if (held) c.setBase(U.mood()); else if (was) next();
    }
    btn.addEventListener('focus', () => { focused = focusShown(); pause(); });
    btn.addEventListener('blur', () => { focused = false; pause(); });
    btn.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') { hovered = true; pause(); } });
    btn.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') { hovered = false; pause(); } });
    btn.addEventListener('click', () => U.openSheet(btn));
    window.addEventListener('resize', () => { x = Math.min(x, room()); place(); });

    let lastMood = null;
    U.onChange((v, ev) => {
      if (!v.on || !v.status) { wrap.hidden = true; html.classList.remove('has-pet'); return; }
      btn.setAttribute('aria-label', U.label(v));
      if (ev.sheet !== undefined) { sheetOpen = ev.sheet; c.hold(sheetOpen); }
      if (ev.sheet === false) { try { hovered = btn.matches(':hover'); } catch (e) { hovered = false; } held = hovered || focused ? 1 : 0; }
      if (!placed && lane.clientWidth) {
        placed = true;
        x = U.reduced ? room() / 2 : Math.random() * room();
      }
      const m = U.mood(v);
      if (m !== lastMood || ev.sheet === false) { lastMood = m; next(); }
      if (ev.fed) c.play(['eat', 'happy']);
    });
    /* 第一次量得到寬度時(版面排好以後)再放位置 */
    requestAnimationFrame(() => { if (!placed) { placed = true; x = U.reduced ? room() / 2 : Math.random() * room(); place(); } });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', build);
  else build();
  window.PET_ROAM = true;
})();
