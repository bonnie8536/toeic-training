/* 假的 window.UI(js/ui.js):給在很小的假 DOM 裡跑 js/vocab.js 的測試用(tools/test_vocab_banks.js、tools/test_vocab_multi.js)。
   只做 vocab.js 呼叫到的那幾個函式,畫面上的字(結算卡的標題、數字、按鈕、逐字清單)照真的 js/ui.js 放進元素裡,測試才讀得到。
   確認視窗(confirm)同步回 true,方便測試一路往下跑。
   用法:ctx.UI = require('./fake_ui')(ctx.document);
   UI.last.next 是專心模式回饋條上「下一題」或「看成績」的按鈕(按一下就是答完這題往下),UI.last.fb 是那一次回饋的內容,UI.last.focus 是目前的專心模式。 */
module.exports = function fakeUI(doc) {
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null && text !== '') e.textContent = text;
    return e;
  };
  const action = (a, cls) => {
    const b = el(a.href ? 'a' : 'button', cls, a.label);
    if (a.href) b.setAttribute('href', a.href);
    if (typeof a.onClick === 'function') b.addEventListener('click', e => a.onClick(e));
    return b;
  };
  const UI = {
    last: { next: null, fb: null, focus: null, results: [] },
    doodle: () => Promise.resolve(false),
    empty(o) {
      const box = el('div', 'ui-empty');
      box.append(el('p', 'ui-empty-text', o.text));
      if (o.action && o.action.label) box.append(action(o.action, 'btn ui-empty-go'));
      box.destroy = () => {};
      return box;
    },
    confirm() { return { then(f) { f(true); return this; } }; },
    prompt() { return { then(f) { f(null); return this; } }; },
    focus: {
      enter(opt) {
        const api = {
          opt, cur: 0, total: opt.total, isDirty: false, gone: false, active: true,
          progress(n) { api.cur = n; },
          setTotal(n) { api.total = n; },
          dirty(v) { api.isDirty = v === undefined ? true : !!v; },
          foot() { UI.last.next = null; UI.last.fb = null; },
          action() {},
          feedback(f) {
            const b = el('button', 'btn primary quiz-next', f.next || '下一題');
            b.addEventListener('click', e => { if (typeof f.onNext === 'function') f.onNext(e); });
            UI.last.next = b;
            UI.last.fb = f;
            return b;
          },
          leave() { api.gone = true; api.active = false; },
        };
        UI.last.focus = api;
        return api;
      },
    },
    result(o) {
      const card = el('section', 'result-card' + (o.compact ? ' is-compact' : ''));
      const scored = typeof o.score === 'number' && typeof o.total === 'number';
      const heading = el('h2', 'result-score', (scored ? o.score + ' / ' + o.total : String(o.big === undefined ? '' : o.big) + (o.unit ? ' ' + o.unit : '')) + (o.flag ? ' ' + o.flag : ''));
      heading.before = n => { const i = card.children.indexOf(heading); n.parentNode = card; card.children.splice(i, 0, n); };
      if (o.kicker) card.append(el('p', 'result-kicker', o.kicker));
      card.append(heading);
      if (Array.isArray(o.stats) && o.stats.length) {
        const dl = el('dl', 'result-stats');
        o.stats.forEach(s => { const d = el('div', 'result-stat'); d.append(el('dt', null, String(s[0])), el('dd', null, String(s[1]))); dl.append(d); });
        card.append(dl);
      }
      const reward = el('div', 'result-reward');
      card.append(reward);
      const acts = el('div', 'result-actions');
      if (o.primary) acts.append(action(o.primary, 'btn primary result-go'));
      if ((o.links || []).length) { const l = el('div', 'result-links'); o.links.forEach(x => l.append(action(x, 'btn-text result-link'))); acts.append(l); }
      card.append(acts);
      if (o.note) card.append(el('p', 'result-note', o.note));
      const api = { el: card, reward, heading, pose: o.pose || null, opt: o, destroy() {} };
      UI.last.results.push(api);
      return api;
    },
    detail(title, nodes, opt) {
      const d = el('details', 'result-detail');
      d.append(el('summary', 'result-detail-sum', title));
      const body = el('div', 'result-detail-body');
      [].concat(nodes || []).filter(Boolean).forEach(n => body.append(n));
      d.append(body);
      d.wrong = opt && opt.wrong;
      return d;
    },
  };
  return UI;
};
