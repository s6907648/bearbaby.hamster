// 🐹 倉鼠小窩 - Server (Postgres + Neon Storage)
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
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

// ── Postgres Pool ─────────────────────────────────────
const pool = new Pool({
 connectionString: process.env.DATABASE_URL,
 ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ── Telegram 通知 ────────────────────────────────────
const TELEGRAM_BOT_TOKEN = "740701…9LvY";
const TELEGRAM_CHAT_ID = "7088717749";
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
📦 狀態：${statusMap[product.status] || '未知'}`;
 sendTelegram(msg);
}

function json(res, data) { res.set("Content-Type", "application/json").json(data); }
function err(res, code, msg) { res.status(code).json({ error: msg }); }

// ── 初始化資料表 ──────────────────────────────────────
async function initDB() {
 const client = await pool.connect();
 try {
 await client.query(`
 CREATE TABLE IF NOT EXISTS products (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 category TEXT NOT NULL DEFAULT 'goods',
 name TEXT NOT NULL,
 description TEXT,
 price INTEGER NOT NULL DEFAULT 0,
 image TEXT,
 video TEXT,
 status SMALLINT NOT NULL DEFAULT 0,
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ DEFAULT NOW(),
 updated_at TIMESTAMPTZ DEFAULT NOW()
 );
 CREATE TABLE IF NOT EXISTS shop (
 id INTEGER PRIMARY KEY,
 shop_name TEXT,
 logo_emoji TEXT,
 intro TEXT,
 bank_code TEXT,
 bank_name TEXT,
 account TEXT,
 note TEXT
 );
 `);
 const count = await client.query('SELECT COUNT(*) FROM products');
 if (parseInt(count.rows[0].count) === 0) {
 const seed = [
 ['金絲熊寶寶', 'hamster', 680, '活潑可愛的金絲熊，毛色金黃。'],
 ['三線侏儒倉鼠', 'hamster', 520, '溫馴親人，體型小巧。'],
 ['老公公倉鼠', 'hamster', 750, '動作敏捷、毛色特殊。'],
 ['木質雙層鼠籠', 'goods', 890, '原木質感，給鼠寶貝溫暖的家。'],
 ['靜音跑輪', 'goods', 260, '夜間靜音設計，不擾眠。'],
 ['綜合飼料禮盒', 'goods', 320, '營養均衡，專業調配。'],
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
 }
 } finally { client.release(); }
}

// ── Multer 上傳設定（記憶體模式）─────────────────────
const upload = multer({
 storage: multer.memoryStorage(),
 limits: { fileSize: 200 * 1024 * 1024 },
 fileFilter: (req, file, cb) => {
 const allowed = /jpeg|jpg|png|gif|webp|mp4|mov|avi|webm/;
 const ext = allowed.test(path.extname(file.originalname).slice(1).toLowerCase());
 const mime = allowed.test((file.mimetype.split("/")[1] || "").toLowerCase());
 if (ext && mime) return cb(null, true);
 cb(new Error("不支援的檔案格式"));
 },
});

const sseClients = new Set();
function sseBroadcast(data) {
 const payload = `data: ${JSON.stringify(data)}\n\n`;
 for (const res of sseClients) { try { res.write(payload); } catch(e) {} }
}

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use((req, res, next) => {
 res.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
 next();
});
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/admin", (req, res) => res.sendFile(path.join(__dirname, "public", "admin.html")));

app.get("/api/events", (req, res) => {
 res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive" });
 res.flushHeaders();
 sseClients.add(res);
 req.on("close", () => sseClients.delete(res));
});

app.get("/api/products", async (req, res) => {
 try {
 const r = await pool.query("SELECT * FROM products ORDER BY sort_order, created_at");
 json(res, r.rows);
 } catch(e) { err(res, 500, e.message); }
});

app.post("/api/products", async (req, res) => {
 try {
 const { name, category = 'goods', description = '', price = 0, status = 0 } = req.body;
 const r = await pool.query(
 `INSERT INTO products (name, category, description, price, status) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
 [name, category, description, price, status]
 );
 const p = r.rows[0];
 sseBroadcast({ type: "created", product: p });
 notifyOwner(p, 'create');
 json(res, p);
 } catch(e) { err(res, 500, e.message); }
});

app.put("/api/products/:id", async (req, res) => {
 try {
 const { name, category, description, price, status, sort_order } = req.body;
 const r = await pool.query(
 `UPDATE products SET name=$1, category=$2, description=$3, price=$4, status=$5, sort_order=$6, updated_at=NOW() WHERE id=$7 RETURNING *`,
 [name, category, description, price, status, sort_order, req.params.id]
 );
 if (!r.rows.length) return err(res, 404, "Not found");
 sseBroadcast({ type: "updated", product: r.rows[0] });
 notifyOwner(r.rows[0], 'update');
 json(res, r.rows[0]);
 } catch(e) { err(res, 500, e.message); }
});

app.patch("/api/products/:id/status", async (req, res) => {
 try {
 const { status } = req.body;
 const r = await pool.query("UPDATE products SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *", [status, req.params.id]);
 if (!r.rows.length) return err(res, 404, "Not found");
 sseBroadcast({ type: "updated", product: r.rows[0] });
 notifyOwner(r.rows[0], 'update');
 json(res, r.rows[0]);
 } catch(e) { err(res, 500, e.message); }
});

app.delete("/api/products/:id", async (req, res) => {
 try {
 const r = await pool.query("SE
...(truncated)...
