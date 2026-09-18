/**
 * 倉鼠小窩 - Express + JSON 商店系統
 * 狀態：0=上架中  1=暫售  2=已完售
 */

const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");

// ─── 路徑 ─────────────────────────────────────────────────
const DATA_DIR   = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(__dirname, "uploads");
const DB_FILE    = path.join(DATA_DIR, "shop.json");
[DATA_DIR, UPLOAD_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── JSON 資料庫 ───────────────────────────────────────────
function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const def = {
      products: [
        { id:uid(),category:"hamster",name:"金絲熊寶寶",  description:"圓滾滾的金絲熊，個性溫馴親人，適合第一次養鼠的新手。",price:680, image:"",video:"",status:0,sort_order:1, created_at:now,updated_at:now },
        { id:uid(),category:"hamster",name:"三線侏儒倉鼠",description:"體型迷你的三線寶貝，活潑好動，喜歡在跑輪上轉圈圈。",      price:520, image:"",video:"",status:0,sort_order:2, created_at:now,updated_at:now },
        { id:uid(),category:"hamster",name:"老公公倉鼠",  description:"超迷你、眼睛亮晶晶的老公公，動作敏捷又可愛十足。",      price:750, image:"",video:"",status:0,sort_order:3, created_at:now,updated_at:now },
        { id:uid(),category:"goods",  name:"木質雙層鼠籠",description:"通風好清理的木質雙層籠，給寶貝舒適又安全的家。",        price:890, image:"",video:"",status:0,sort_order:4, created_at:now,updated_at:now },
        { id:uid(),category:"goods",  name:"靜音跑輪",    description:"超靜音軸承設計，半夜也不吵，讓寶貝盡情運動。",            price:260, image:"",video:"",status:0,sort_order:5, created_at:now,updated_at:now },
        { id:uid(),category:"goods",  name:"綜合飼料禮盒",description:"營養均衡的綜合飼料+曬乾點心，滿滿一盒愛心。",            price:320, image:"",video:"",status:0,sort_order:6, created_at:now,updated_at:now },
      ],
      shop: { shop_name:"倉鼠小窩", logo_emoji:"🐹", intro:"用心照顧每一隻小生命" },
    };
    saveDB(def);
    return def;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(data) { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8"); }
function uid()        { return crypto.randomUUID(); }
function now()        { return new Date().toISOString().replace("T", " ").slice(0, 19); }

let db = loadDB();

// ─── Multer ───────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => cb(null, uid() + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|avi|webm/;
    const ext = allowed.test(path.extname(file.originalname).slice(1).toLowerCase());
    const mime = allowed.test(file.mimetype.split("/")[1] || "");
    if (ext || mime) return cb(null, true);
    cb(new Error("僅支援圖片（jpg/png/webp/gif）或影片（mp4/mov）"));
  }
});

// ─── SSE 即時通知客戶端 ────────────────────────────────────
const sseClients = new Set();
function sseBroadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch(e) { sseClients.delete(res); }
  }
  console.log(`[SSE 廣播] ${JSON.stringify(data)}`);
}

// ─── Telegram Bot 設定 ────────────────────────────────
const TELEGRAM_BOT_TOKEN = "7407012813:AAH3w5tYgtdvKJZvsT1R8AKulzme4Id9LvY";
const TELEGRAM_CHAT_ID   = "7088717749";

async function sendTelegram(msg) {
  try {
    const { execSync } = require("child_process");
    const encoded = encodeURIComponent(msg);
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encoded}&parse_mode=HTML`;
    execSync(`curl.exe -s -o nul "${url}"`, { timeout: 10000 });
    console.log("[Telegram] 通知已發送！");
  } catch(e) {
    console.error("[Telegram] 發送失敗：", e.message);
  }
}

// ─── 通知鉤子（可擴充至 LINE/Telegram/Email）───────────────
async function notifyOwner(type, product, extra = {}) {
  const msg = `[🐹 倉鼠小窩 通知]
類型：${type}
商品名：${product.name}
分類：${product.category === "hamster" ? "🐹 倉鼠" : "🏠 周邊商品"}
價格：NT$ ${product.price}
${extra.note || ""}
時間：${now()}`;

  console.log("\n═══════════════════════════════════════");
  console.log("📢 有新通知！");
  console.log(msg);
  console.log("═══════════════════════════════════════\n");

  // 發送 Telegram 通知（非同步，不卡住主流程）
  sendTelegram(msg);
}

// ─── Express ──────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(UPLOAD_DIR));
app.get("/admin", (req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

// ─── SSE 事件流 ───────────────────────────────────────────
app.get("/api/events", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control","no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  // 送 keep-alive ping 每 25s
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch(e){ clearInterval(ping); } }, 25000);

  sseClients.add(res);
  console.log(`[SSE] 客戶端連線，目前 ${sseClients.size} 個`);

  // 立即送連線成功
  res.write(`data: ${JSON.stringify({ type:"connected", time: now() })}\n\n`);

  req.on("close", () => {
    clearInterval(ping);
    sseClients.delete(res);
    console.log(`[SSE] 客戶端斷線，剩下 ${sseClients.size} 個`);
  });
});

// ─── 工具 ─────────────────────────────────────────────────
const json  = (res, data) => res.json(data);
const error = (res, status, msg) => res.status(status).json({ error: msg });

// ─── 商品 API ─────────────────────────────────────────────
app.get("/api/products", (req, res) => {
  const rows = [...db.products].sort((a,b) => (b.sort_order||0)-(a.sort_order||0) || a.created_at.localeCompare(b.created_at));
  json(res, rows);
});

app.get("/api/products/:id", (req, res) => {
  const row = db.products.find(p => p.id === req.params.id);
  if (!row) return error(res, 404, "找不到此商品");
  json(res, row);
});

app.post("/api/products", (req, res) => {
  const { category, name, description, price, sort_order } = req.body;
  if (!category || !name) return error(res, 400, "缺少必填欄位（category、name）");
  const t = now();
  const p = {
    id: uid(), category, name,
    description: description || "",
    price: Number(price) || 0,
    sort_order: Number(sort_order) || 0,
    image: "", video: "", status: 0,
    created_at: t, updated_at: t
  };
  db.products.push(p);
  saveDB(db);
  json(res, p);
});

app.put("/api/products/:id", (req, res) => {
  const idx = db.products.findIndex(p => p.id === req.params.id);
  if (idx < 0) return error(res, 404, "找不到此商品");
  const { name, description, price, category, status, sort_order } = req.body;
  const cur = db.products[idx];
  db.products[idx] = {
    ...cur,
    name:        name        ?? cur.name,
    description: description ?? cur.description,
    price:       price      !== undefined ? Number(price)    : cur.price,
    category:    category    ?? cur.category,
    status:      status     !== undefined ? Number(status)    : cur.status,
    sort_order:  sort_order !== undefined ? Number(sort_order): cur.sort_order,
    updated_at:  now()
  };
  saveDB(db);
  // 廣播給所有 SSE 客戶端
  sseBroadcast({ type: "product_updated", product: db.products[idx] });
  json(res, db.products[idx]);
});

// 狀態更新（客人付款觸發 → 暫售）
app.patch("/api/products/:id/status", (req, res) => {
  const idx = db.products.findIndex(p => p.id === req.params.id);
  if (idx < 0) return error(res, 404, "找不到此商品");
  const newStatus = Number(req.body.status);
  if (![0,1,2].includes(newStatus)) return error(res, 400, "status 必須是 0（上架中）、1（暫售）或 2（已完售）");

  const prevStatus = db.products[idx].status;
  db.products[idx].status = newStatus;
  db.products[idx].updated_at = now();
  saveDB(db);

  const product = db.products[idx];

  // 廣播 SSE
  sseBroadcast({ type: "product_updated", product });

  // 觸發通知鉤子
  if (newStatus === 1 && prevStatus !== 1) {
    notifyOwner("🛒 客人付款通知（待確認）", product, {
      note: "⚠️ 請至後台確認後，點擊「完成交易」或「取消交易」"
    });
  }
  if (newStatus === 2) {
    notifyOwner("✅ 商品已完售", product, { note: "" });
  }

  json(res, product);
});

// 維持 sold 相容（舊客戶端）
app.patch("/api/products/:id/sold", (req, res) => {
  const idx = db.products.findIndex(p => p.id === req.params.id);
  if (idx < 0) return error(res, 404, "找不到此商品");
  const sold = Number(req.body.sold);
  db.products[idx].status = sold ? 2 : 0;
  db.products[idx].updated_at = now();
  saveDB(db);
  sseBroadcast({ type: "product_updated", product: db.products[idx] });
  json(res, db.products[idx]);
});

app.delete("/api/products/:id", (req, res) => {
  const idx = db.products.findIndex(p => p.id === req.params.id);
  if (idx < 0) return error(res, 404, "找不到此商品");
  const p = db.products[idx];
  [p.image, p.video].forEach(f => {
    if (f) { const fp = path.join(UPLOAD_DIR, path.basename(f)); if (fs.existsSync(fp)) fs.unlinkSync(fp); }
  });
  db.products.splice(idx, 1);
  saveDB(db);
  sseBroadcast({ type: "product_deleted", id: req.params.id });
  json(res, { success: true });
});

// ─── 上傳 API ─────────────────────────────────────────────
function doUpload(req, res, field) {
  if (!req.file) return error(res, 400, "未收到檔案");
  const idx = db.products.findIndex(p => p.id === req.params.productId);
  if (idx < 0) { fs.unlinkSync(req.file.path); return error(res, 404, "找不到此商品"); }
  const url = `/uploads/${req.file.filename}`;
  if (db.products[idx][field]) {
    const old = path.join(UPLOAD_DIR, path.basename(db.products[idx][field]));
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  db.products[idx][field] = url;
  db.products[idx].updated_at = now();
  saveDB(db);
  sseBroadcast({ type: "product_updated", product: db.products[idx] });
  json(res, { url, product: db.products[idx] });
}

app.post("/api/upload/image/:productId",  upload.single("file"), (req, res) => doUpload(req, res, "image"));
app.post("/api/upload/video/:productId",  upload.single("file"), (req, res) => doUpload(req, res, "video"));

app.delete("/api/upload/image/:productId", (req, res) => {
  const idx = db.products.findIndex(p => p.id === req.params.productId);
  if (idx < 0) return error(res, 404, "找不到此商品");
  if (db.products[idx].image) {
    const fp = path.join(UPLOAD_DIR, path.basename(db.products[idx].image));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.products[idx].image = "";
    db.products[idx].updated_at = now();
    saveDB(db);
    sseBroadcast({ type: "product_updated", product: db.products[idx] });
  }
  json(res, { success: true });
});

app.delete("/api/upload/video/:productId", (req, res) => {
  const idx = db.products.findIndex(p => p.id === req.params.productId);
  if (idx < 0) return error(res, 404, "找不到此商品");
  if (db.products[idx].video) {
    const fp = path.join(UPLOAD_DIR, path.basename(db.products[idx].video));
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    db.products[idx].video = "";
    db.products[idx].updated_at = now();
    saveDB(db);
    sseBroadcast({ type: "product_updated", product: db.products[idx] });
  }
  json(res, { success: true });
});

// ─── 店鋪 API ─────────────────────────────────────────────
app.get("/api/shop", (req, res) => { json(res, db.shop || {}); });

app.put("/api/shop", (req, res) => {
  const s = db.shop || {};
  const { shop_name, logo_emoji, intro, bank_code, bank_name, account, note } = req.body;
  db.shop = {
    shop_name:  shop_name  ?? s.shop_name  ?? "倉鼠小窩",
    logo_emoji: logo_emoji ?? s.logo_emoji ?? "🐹",
    intro:      intro      ?? s.intro      ?? "用心照顧每一隻小生命",
    bank_code:  bank_code  ?? s.bank_code  ?? "",
    bank_name:  bank_name  ?? s.bank_name  ?? "",
    account:    account    ?? s.account    ?? "",
    note:       note       ?? s.note       ?? "",
  };
  saveDB(db);
  sseBroadcast({ type: "shop_updated", shop: db.shop });
  json(res, db.shop);
});

// ─── 啟動 ─────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🐹 倉鼠小窩 商店系統已啟動！`);
  console.log(`   📦 前台：http://localhost:${PORT}`);
  console.log(`   ⚙  管理後台：http://localhost:${PORT}/admin`);
  console.log(`   🔔 SSE 通知：http://localhost:${PORT}/api/events`);
  console.log(`   📁 資料：${DB_FILE}\n`);
});
