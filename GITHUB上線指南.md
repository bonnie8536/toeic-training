# 上線指南:GitHub Pages + Supabase(帳號由妳發放)

照順序做一次就好,之後日常只剩「發帳號」一件事。
全程不用寫程式;需要貼的東西都在這個資料夾裡。

## A. 建 Supabase 專案(存學生資料用,免費)

1. 到 supabase.com 註冊/登入 → New project。
2. 名稱隨意(例 toeic-class),資料庫密碼自己設一組收好,Region 選 Northeast Asia (Tokyo)。
3. 建好後到 **Project Settings → API**,抄下兩個值:
   - Project URL(長得像 `https://xxxx.supabase.co`)
   - `anon` `public` key(一長串文字)

## B. 初始化資料表

1. 左邊選 **SQL Editor** → New query。
2. 打開本資料夾 `tools/supabase_setup.sql`,整份複製貼上 → Run。
3. 看到 Success 即完成(建立 progress 與 teachers 兩張表+權限規則)。

## C. 關閉自行註冊(關鍵步驟)

1. **Authentication → Sign In / Up(或 Providers)→ Email**:
   - 關閉 **Confirm email**(不然假 email 帳號收不到驗證信)。
2. 同頁找到 **Allow new users to sign up** → **關閉**。
   關閉後,只有妳能在後台建帳號,學生無法自創。

## D. 建妳自己的教師帳號

1. **Authentication → Users → Add user → Create new user**:
   填妳的 email 與密碼(這組就是妳登入網站與教師後台的帳密)。
2. 建立後點進該使用者,複製它的 **User UID**(一串 uuid)。
3. 回 **SQL Editor**,執行(把引號裡換成剛複製的 UID):

   ```sql
   insert into public.teachers (user_id) values ('把UID貼在這裡');
   ```

## E. 發學生帳號(日常操作就這個)

**Authentication → Users → Add user**,一人一組:
- Email 不必是真信箱,格式像 email 就行,例:`anna@bonnie.class`、`s01@bonnie.class`
  (@ 前面那段會顯示成學生名稱,建議用學生好記的代號)
- 密碼妳設好抄給學生。改密碼/停用也都在這個頁面。

## F. 把金鑰填進網站

打開 `js/cloud-config.js`,把步驟 A 抄的兩個值填進去:

```js
window.CLOUD_CONFIG = {
  url: 'https://xxxx.supabase.co',
  anonKey: '貼anon key',
};
```

存檔。這一步之後,網站就從「本機模式」變成「登入模式」。

## G. 放上 GitHub Pages

1. GitHub 建一個 repo(可公開,例 toeic-training)。
2. 把整個資料夾的檔案上傳(網頁版直接拖曳即可;`data/raw/` 與 `tools/` 可傳可不傳,不影響網站)。
3. Repo → **Settings → Pages** → Source 選 `Deploy from a branch`,Branch 選 `main` / `(root)` → Save。
4. 一兩分鐘後網址就是 `https://你的帳號.github.io/toeic-training/`,把網址給學生。

## H. 驗證清單(上線後花三分鐘)

1. 開網址 → 進「程度檢測」→ 出現登入視窗(不是本機建檔視窗)= 雲端模式生效。
2. 用一個學生帳號登入 → 隨便答兩題 → 換一台裝置(或無痕視窗)登入同帳號 → 進度有跟上 = 同步正常。
3. 用妳的教師帳號登入 → 右上角選單多了「教師後台」→ 看得到剛剛那位學生的列 = 權限正確。

## 注意事項

- **anon key 可以公開**(它只是通行證,能做什麼由資料庫權限規則決定),放 GitHub 沒問題。
- **免費版專案約一週沒有任何流量會休眠**,學生會登入失敗。到 Supabase 後台按 Restore 即可復原;有學生固定每週使用就不會發生。
- **題庫答案在前端檔案裡**:會開發者工具的學生查得到答案。這是練習工具不是正式考試,屬可接受;若之後要拿來當計分測驗再談後端出題。
- 兩個值留空 = 回到本機模式,妳面對面上課、離線用都照舊。
- 想看原始資料:Supabase → Table Editor → progress。
