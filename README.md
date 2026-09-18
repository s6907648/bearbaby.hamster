# 🐹 倉鼠小窩 - 網路商店系統

用手機瀏覽的雙層倉鼠商品網頁，前後台完整系統。

## 功能

- 前台：首頁 → 鼠寶貝/周邊分類 → 商品詳情 → 匯款結帳
- 後台：商品增刪改、圖片/影片上傳、狀態管理、Telegram 即時通知
- 狀態流程：上架中 → 顧客付款（待確認）→ 管理者確認（完售）

## 部署到 Render.com

1. 將此資料夾上傳到 GitHub
2. 前往 [render.com](https://render.com) → New → Web Service
3. 連接 GitHub repo，設定：
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. 部署完成

## 本地開發

```bash
cd hamster-shop
npm install
node server.js
# 前台：http://localhost:3000
# 後台：http://localhost:3000/admin
```
