// 🐹 倉鼠小窩 - Server (Postgres 版)
const express = require("express");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const { Pool } = require("pg");

// ── Neon Object Storage (S3) ─────────────────────────
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
const S3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-2",
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.S3_BUCKET || "hamster-uploads";
const PUBLIC_BASE = (process.env.AWS_ENDPOINT_URL_S3 || "").replace(/\/$/, "");
async function s3Upload(key, buffer, contentType) {
  await S3.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType,
  }));
  return `${PUBLIC_BASE}/${BUCKET}/${key}`;
}
async function s3Delete(key) {
  if (!key) return;
  try { await S3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key })); } catch(e){}
}
function keyFromUrl(url) {
  if (!url) return null;
  try { return new URL(url).pathname.replace(/^\//, "").replace(new RegExp("^" + BUCKET + "/"), ""); }
  catch(e) { return null; }
}

// ── Telegram 通知 ────────────────────────────────────
const TELEGRAM_BOT_TOKEN = "7407012813:AAH3w5tYgtdvKJZvsT1R8AKulzme4Id9LvY";
const TELEGRAM_CHAT_ID   = "7088717749";
function sendTelegram(msg) {
  try {
    const { execSync } = require("child_process");
    const encoded = encodeURIComponent(msg);
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage?chat_id=${TELEGRAM_CHAT_ID}&text=${encoded}&parse_mode=HTML`;
    execSync(`curl.exe -s -o nul "${url}"`, { stdio: "ignore", timeout: 5000 });
  } catch(e) {}
}
function notifyOwner(product, action) {
  const statusMap = { 0: '上架中', 1: '待確認', 2: '已完售' };
  const emoji = action === 'create' ? '🆕' : action === 'pay' ? '💰' : '🔄';
  const title = action === 'pay' ? '顧客付款通知' : action === 'create' ? '新商品上架' : '狀態更新';
  const msg = `${emoji} <b>${title}</b>
🐹 商品：${product.name}
💰 價格：NT$ ${Number(product.price).toLocaleString()}
📦 狀態：${statusMap[product.status] || '未知'}
📁 分類：${product.category === 'hamster' ? '鼠寶貝' : '周邊用品'}`;
  sendTelegram(msg);
}

// ── Postgres ──────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : false,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT NOT NULL,
        category    TEXT NOT NULL CHECK (category IN ('hamster','goods')),
        price       INTEGER NOT NULL DEFAULT 0,
        description TEXT,
        image       TEXT,
        video       TEXT,
        status      INTEGER NOT NULL DEFAULT 0,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS shop (
        id          INTEGER PRIMARY KEY DEFAULT 1,
        shop_name   TEXT,
        logo_emoji  TEXT,
        intro       TEXT,
        bank_name   TEXT,
        account     TEXT,
        note        TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
      CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status);
    `);

    const count = await client.query('SELECT COUNT(*) FROM products');
    if (parseInt(count.rows[0].count) === 0) {
      console.log('[DB] Seeding default products...');
      const seed = [
        ['金絲熊寶寶',   'hamster', 680, '活潑可愛的金絲熊，毛色金黃。'],
        ['三線侏儒倉鼠', 'hamster', 520, '溫馴親人，體型小巧。'],
        ['老公公倉鼠',   'hamster', 750, '動作敏捷、毛色特殊。'],
        ['木質雙層鼠籠', 'goods',   890, '原木質感，給鼠寶貝溫暖的家。'],
        ['靜音跑輪',     'goods',   260, '夜間靜音設計，不擾眠。'],
        ['綜合飼料禮盒', 'goods',   320, '營養均衡，專業調配。'],
      ];
      for (const [name, category, price, description] of seed) {
        await client.query(
          'INSERT INTO products (name, category, price, description, status, sort_order) VALUES ($1,$2,$3,$4,$5,$6)',
          [name, category, price, description, 0, 0]
        );
      }
      await client.query(`INSERT INTO shop (id, shop_name, logo_emoji, intro, bank_name, account, note)
                          VALUES (1, '倉鼠小窩', '🐹', '用心照顧每一隻小生命', '', '', '')
                          ON CONFLICT (id) DO NOTHING`);
      console.log('[DB] Seed done');
    }
  } finally { client.release(); }
}

// ── Multer 上傳設定 ───────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|avi|webm/;
    const ext  = allowed.test(path.extname(file.originalname).slice(1).toLowerCase());
    const mime = allowed.test((file.mimetype.split("/")[1] || "").toLowerCase());
    if (ext && mime) return cb(null, true);
    cb(new Error("不支援的檔案格式"));
  },
});

// ── SSE ───────────────────────────────────────────────
const sseClients = new Set();
function sseBroadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) { try { res.write(payload); } catch(e) {} }
}

// ── App ───────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  next();
});
app.get("/",  (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/api/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
  res.flushHeaders();
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch(e){ clearInterval(ping); sseClients.delete(res); } }, 25000);
  req.on("close", () => { clearInterval(ping); sseClients.delete(res); });
});

const json = (res, data) => res.json(data);
const err  = (res, status, msg) => res.status(status).json({ error: msg });

// ── Products API ──────────────────────────────────────
app.get("/api/products", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM products ORDER BY sort_order DESC, created_at ASC");
    json(res, r.rows);
  } catch(e) { err(res, 500, e.message); }
});

app.get("/api/products/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (!r.rows.length) return err(res, 404, "Not found");
    json(res, r.rows[0]);
  } catch(e) { err(res, 500, e.message); }
});

app.post("/api/products", async (req, res) => {
  try {
    const { category, name, description = "", price = 0, sort_order = 0 } = req.body;
    if (!name || !category) return err(res, 400, "name & category required");
    const r = await pool.query(
      `INSERT INTO products (name, category, price, description, sort_order, status)
       VALUES ($1,$2,$3,$4,$5,0) RETURNING *`,
      [name, category, price, description, sort_order]
    );
    const p = r.rows[0];
    sseBroadcast({ type: "created", product: p });
    notifyOwner(p, "create");
    json(res, p);
  } catch(e) { err(res, 500, e.message); }
});

app.put("/api/products/:id", async (req, res) => {
  try {
    const { name, description, price, category, status, sort_order } = req.body;
    const cur = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (!cur.rows.length) return err(res, 404, "Not found");
    const p = cur.rows[0];
    const upd = await pool.query(
      `UPDATE products SET
        name        = COALESCE($1, name),
        description = COALESCE($2, description),
        price       = COALESCE($3, price),
        category    = COALESCE($4, category),
        status      = COALESCE($5, status),
        sort_order  = COALESCE($6, sort_order)
       WHERE id = $7 RETURNING *`,
      [name ?? null, description ?? null, price ?? null, category ?? null, status ?? null, sort_order ?? null, req.params.id]
    );
    const np = upd.rows[0];
    sseBroadcast({ type: "updated", product: np });
    if (status !== undefined && status !== p.status) notifyOwner(np, status === 1 ? 'pay' : 'status');
    json(res, np);
  } catch(e) { err(res, 500, e.message); }
});

app.patch("/api/products/:id/status", async (req, res) => {
  try {
    const newStatus = Number(req.body.status);
    const cur = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (!cur.rows.length) return err(res, 404, "Not found");
    const r = await pool.query(
      "UPDATE products SET status = $1 WHERE id = $2 RETURNING *",
      [newStatus, req.params.id]
    );
    const p = r.rows[0];
    sseBroadcast({ type: "status", product: p });
    if (newStatus === 1 && cur.rows[0].status !== 1) notifyOwner(p, "pay");
    else if (newStatus === 2 && cur.rows[0].status !== 2) notifyOwner(p, "status");
    json(res, p);
  } catch(e) { err(res, 500, e.message); }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM products WHERE id = $1", [req.params.id]);
    if (!r.rows.length) return err(res, 404, "Not found");
    const p = r.rows[0];
    await s3Delete(keyFromUrl(p.image));
    await s3Delete(keyFromUrl(p.video));
    await pool.query("DELETE FROM products WHERE id = $1", [req.params.id]);
    sseBroadcast({ type: "deleted", id: req.params.id });
    json(res, { ok: true });
  } catch(e) { err(res, 500, e.message); }
});

// ── Upload API (走 Neon Object Storage) ───────────────
function doUpload(field) {
  return async (req, res) => {
    try {
      if (!req.file) return err(res, 400, "No file");
      const ext = path.extname(req.file.originalname).toLowerCase();
      const key = `${field}/${req.params.productId}/${Date.now()}${ext}`;

      // 先刪舊檔（如果有）
      const old = await pool.query(`SELECT ${field} FROM products WHERE id = $1`, [req.params.productId]);
      if (old.rows[0] && old.rows[0][field]) await s3Delete(keyFromUrl(old.rows[0][field]));

      const url = await s3Upload(key, req.file.buffer, req.file.mimetype);
      const r = await pool.query(
        `UPDATE products SET ${field} = $1 WHERE id = $2 RETURNING *`,
        [url, req.params.productId]
      );
      if (!r.rows.length) return err(res, 404, "Product not found");
      sseBroadcast({ type: "updated", product: r.rows[0] });
      json(res, { ok: true, url, product: r.rows[0] });
    } catch(e) { err(res, 500, e.message); }
  };
}

app.post("/api/upload/image/:productId", upload.single("file"), doUpload("image"));
app.post("/api/upload/video/:productId", upload.single("file"), doUpload("video"));

app.delete("/api/upload/image/:productId", async (req, res) => {
  try {
    const r = await pool.query("SELECT image FROM products WHERE id = $1", [req.params.productId]);
    if (!r.rows.length) return err(res, 404, "Not found");
    await s3Delete(keyFromUrl(r.rows[0].image));
    await pool.query("UPDATE products SET image = NULL WHERE id = $1", [req.params.productId]);
    json(res, { ok: true });
  } catch(e) { err(res, 500, e.message); }
});

app.delete("/api/upload/video/:productId", async (req, res) => {
  try {
    const r = await pool.query("SELECT video FROM products WHERE id = $1", [req.params.productId]);
    if (!r.rows.length) return err(res, 404, "Not found");
    await s3Delete(keyFromUrl(r.rows[0].video));
    await pool.query("UPDATE products SET video = NULL WHERE id = $1", [req.params.productId]);
    json(res, { ok: true });
  } catch(e) { err(res, 500, e.message); }
});

// ── Shop API ──────────────────────────────────────────
app.get("/api/shop", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM shop WHERE id = 1");
    json(res, r.rows[0] || {});
  } catch(e) { err(res, 500, e.message); }
});

app.put("/api/shop", async (req, res) => {
  try {
    const { shop_name, logo_emoji, intro, bank_code, bank_name, account, note } = req.body;
    await pool.query(
      `INSERT INTO shop (id, shop_name, logo_emoji, intro, bank_name, account, note)
       VALUES (1, $1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         shop_name  = EXCLUDED.shop_name,
         logo_emoji = EXCLUDED.logo_emoji,
         intro      = EXCLUDED.intro,
         bank_name  = EXCLUDED.bank_name,
         account    = EXCLUDED.account,
         note       = EXCLUDED.note`,
      [shop_name, logo_emoji, intro, bank_name, account, note]
    );
    json(res, { ok: true });
  } catch(e) { err(res, 500, e.message); }
});

// ── 啟動 ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  try {
    if (process.env.DATABASE_URL) {
      await initDB();
      console.log('[DB] Connected & ready');
    } else {
      console.log('[DB] DATABASE_URL not set, will run with empty data');
    }
  } catch(e) {
    console.error('[DB] Init failed:', e.message);
  }
  app.listen(PORT, () => console.log(`Server running on ${PORT}`));
})();