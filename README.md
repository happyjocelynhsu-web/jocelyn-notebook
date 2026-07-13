# 反重力擬真翻書筆記本 (Antigravity Notebook)

這是一個極致擬真的電子書本筆記本 Web App，支援 3D 翻頁效果、手繪/文字雙層編輯系統，並支援跨裝置（iPad + PC）雲端即時同步與特定頁面公開分享。

## ✨ 特色功能

1. **擬真 3D 雙頁翻書**：支援電腦滑鼠拖曳與行動裝置（iPad）觸控滑動翻頁，擁有自然摺皺光影、書脊陰影與透視比例。
2. **雙層筆記系統**：
   - **手繪層 (頂層 Canvas)**：採用 PointerEvents 統一事件處理，完美支援 Apple Pencil 與電繪板的壓感線條。筆跡採用百分比座標紀錄，自適應任何螢幕大小。
   - **文字層 (底層 Text)**：點擊任意紙張空白處即可生成打字輸入框，支援拖曳定位與雙擊刪除。
3. **Supabase 雲端即時同步**：支援與免費 Supabase 資料庫對接，開啟即時同步（Realtime）後在電腦與 iPad 登入時可近乎零延遲地雙向更新手繪與文字！若未設定則自動降級為 LocalStorage 本地儲存模式。
4. **獨立頁面公開分享**：點擊右上角分享，一鍵產生該頁面的獨立公開網址（如 `/share/page_2`），其他人能透過網址唯讀查看，關閉開關後即刻失效。

---

## 🛠️ 開啟與使用方式

### 1. 本地直接執行
因為採用了現代瀏覽器原生支援的 **ES Modules (ESM)**，本專案**不需要任何安裝與編譯步驟**！
您可以直接使用任何靜態網頁伺服器（例如 VS Code 的 Live Server 擴充套件，或 python 內建伺服器 `python -m http.server`）開啟本專案。
*註：由於瀏覽器安全機制（CORS），以 ES Modules 引入的 JS 檔案不支援直接以雙擊 `file://` 開啟，需透過簡易伺服器伺服。*

---

## ☁️ 雲端資料庫 Supabase 設定教學

本專案預設使用本機 `LocalStorage` 運作，若要開啟跨裝置同步與網址分享，請依循以下步驟：

1. 註冊並登入 [Supabase 官網](https://supabase.com)。
2. 建立一個新專案（Project）。
3. 進入專案的 **SQL Editor** 頁面，貼入以下 SQL 碼並執行（Click "Run"）：

```sql
CREATE TABLE IF NOT EXISTS notebook_pages (
  id TEXT PRIMARY KEY,
  page_num INTEGER NOT NULL,
  drawings JSONB DEFAULT '[]'::jsonb,
  texts JSONB DEFAULT '[]'::jsonb,
  is_shared BOOLEAN DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 啟用即時同步功能 (Realtime)
alter publication supabase_realtime add table notebook_pages;
```

4. 進入 **Project Settings > API**，複製您的 `Project URL` 與 `anon public` Key。
5. 開啟您的網頁筆記本，點擊右上角「**本地儲存模式**」按鈕，將 URL 與 Key 貼入，點擊「儲存並連接」即可！

---

## 🚀 部署至 Vercel

您可以使用 Vercel 的免費個人方案部署您的筆記本：

1. 將本專案上傳至您的 GitHub 儲存庫。
2. 登入 [Vercel 官網](https://vercel.com) 並點擊 **Add New > Project**。
3. 匯入該 GitHub 儲存庫，在 **Build & Development Settings** 保留預設值即可（無須輸入任何 Build Command）。
4. 點擊 **Deploy**，部署完成後即可獲得公開的 App 網址！
