// 網站的網址(搬家計畫 5.3)。LIVE 跟著 tools/domain.json 的 live,由 node tools/apply_domain.js 一起改,不要手改。
// - 切換前一天(T-1)先部署 LIVE = 'old' 的這一版:付款回來的頁面還是舊網址,但新網址送來的請求已經放行。
// - 切換日改 tools/domain.json 的 live 成 'new'、跑 apply_domain.js、再部署:這一天只有 SITE 變。
// - 不帶 www 的網址不放進放行清單:GitHub Pages 會把它轉到 www,網頁不會從那裡送出請求。
// - 轉址期(階段 B)開始時把 OLD_SITE 從 SITE_ORIGINS 拿掉再部署(舊網址那時已經不能註冊、不能付款)。
export const OLD_SITE = 'https://www.shuashualanguage.com';
export const NEW_SITE = 'https://www.rushuplanguage.com';
export const LIVE: 'old' | 'new' = 'new';
export const SITE: string = LIVE === 'new' ? NEW_SITE : OLD_SITE;
export const SITE_ORIGINS: readonly string[] = Object.freeze([NEW_SITE, OLD_SITE]);
