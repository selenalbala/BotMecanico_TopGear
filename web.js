const express = require("express");
const fs = require("fs");
const path = require("path");
const config = require("./config");

function env(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return String(value).trim();
}

function existeDirectorio(ruta) {
  try {
    return fs.existsSync(ruta) && fs.statSync(ruta).isDirectory();
  } catch {
    return false;
  }
}

function elegirDataDir() {
  if (config.DATA_FILE) return path.dirname(config.DATA_FILE);
  if (config.DATA_DIR) return config.DATA_DIR;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (existeDirectorio("/data")) return "/data";
  return path.join(__dirname, "data");
}

function normalizarItemId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function leerJsonSeguro(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const text = fs.readFileSync(filePath, "utf8").trim();
    if (!text) return fallback;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    console.warn("No se pudo leer JSON:", filePath, error.message);
    return fallback;
  }
}

function guardarJsonSeguro(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function itemsCalculadora() {
  return (config.CALCULATOR_ITEMS || [])
    .map(item => ({
      id: normalizarItemId(item.id || item.label),
      label: String(item.label || item.id || "").trim(),
      price: Number(item.price) || 0
    }))
    .filter(item => item.id && item.label);
}

function crearStockInicial() {
  return {
    version: 1,
    items: {},
    movements: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function stockFilePath() {
  return path.join(elegirDataDir(), "topgear-web-stock.json");
}

function normalizarStock(raw) {
  const data = raw && typeof raw === "object" ? raw : crearStockInicial();

  data.version = 1;
  data.items = data.items && typeof data.items === "object" && !Array.isArray(data.items) ? data.items : {};
  data.movements = Array.isArray(data.movements) ? data.movements : [];

  for (const item of itemsCalculadora()) {
    const old = data.items[item.id] && typeof data.items[item.id] === "object" ? data.items[item.id] : {};
    let stock = old.stock;

    if (stock === undefined) stock = null;

    if (stock !== null) {
      stock = Number(stock);
      if (!Number.isFinite(stock) || stock < 0) stock = 0;
      stock = Math.floor(stock);
    }

    data.items[item.id] = {
      itemId: item.id,
      label: item.label,
      stock,
      updatedAt: old.updatedAt || null
    };
  }

  data.updatedAt = new Date().toISOString();
  return data;
}

function cargarStock() {
  return normalizarStock(leerJsonSeguro(stockFilePath(), crearStockInicial()));
}

function guardarStock(data) {
  guardarJsonSeguro(stockFilePath(), normalizarStock(data));
}

function requierePin() {
  return Boolean(env("WEB_ADMIN_PIN", ""));
}

function validarPin(req) {
  const expected = env("WEB_ADMIN_PIN", "");
  if (!expected) return true;
  const provided = String(req.headers["x-admin-pin"] || req.body?.pin || "").trim();
  return provided === expected;
}

function stockPublico(data) {
  const result = {};

  for (const [itemId, info] of Object.entries(data.items || {})) {
    result[itemId] = {
      stock: info.stock === null ? null : Number(info.stock) || 0,
      updatedAt: info.updatedAt || null
    };
  }

  return result;
}

function datosPublicos() {
  const stock = cargarStock();

  return {
    currencySuffix: config.CURRENCY_SUFFIX || "$",
    discounts: config.CALCULATOR_DISCOUNTS?.length ? config.CALCULATOR_DISCOUNTS : [0, 5, 10, 15],
    items: itemsCalculadora(),
    stock: stockPublico(stock),
    stockRequiresPin: requierePin()
  };
}

function validarSeleccion(body) {
  const itemMap = new Map(itemsCalculadora().map(item => [item.id, item]));
  const selected = Array.isArray(body?.items) ? body.items : [];
  const discount = Number(body?.discount || 0);

  if (!selected.length) {
    return { error: "No hay servicios añadidos." };
  }

  if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
    return { error: "El descuento no es válido." };
  }

  const lines = [];

  for (const raw of selected) {
    const itemId = normalizarItemId(raw?.id);
    const item = itemMap.get(itemId);
    const quantity = Math.floor(Number(raw?.quantity || 0));

    if (!item) return { error: "Uno de los servicios no existe." };
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999) {
      return { error: `La cantidad de ${item.label} no es válida.` };
    }

    lines.push({
      id: item.id,
      label: item.label,
      price: item.price,
      quantity,
      lineTotal: item.price * quantity
    });
  }

  const subtotal = lines.reduce((acc, line) => acc + line.lineTotal, 0);
  const total = Math.round(subtotal * (1 - discount / 100));

  return { lines, discount, subtotal, total };
}

function comprobarStockDisponible(stockData, lines) {
  for (const line of lines) {
    const info = stockData.items?.[line.id];
    if (!info || info.stock === null) continue;

    const current = Number(info.stock) || 0;

    if (current < line.quantity) {
      return {
        ok: false,
        error: `No hay stock suficiente para ${line.label}. Disponible: ${current}.`
      };
    }
  }

  return { ok: true };
}

function descontarStock(stockData, lines) {
  const now = new Date().toISOString();

  for (const line of lines) {
    const info = stockData.items?.[line.id];
    if (!info || info.stock === null) continue;

    info.stock = Math.max(0, Math.floor((Number(info.stock) || 0) - line.quantity));
    info.updatedAt = now;
  }

  stockData.movements.unshift({
    id: `send_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "send",
    createdAt: now,
    lines
  });

  stockData.movements = stockData.movements.slice(0, 300);
  stockData.updatedAt = now;
}

function iniciarWeb() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  app.get("/api/calculadora", (req, res) => {
    res.json(datosPublicos());
  });

  app.get("/api/web-data", (req, res) => {
    res.json(datosPublicos());
  });

  app.post("/api/enviar", (req, res) => {
    const parsed = validarSeleccion(req.body);

    if (parsed.error) {
      return res.status(400).json({ ok: false, error: parsed.error });
    }

    const stockData = cargarStock();
    const check = comprobarStockDisponible(stockData, parsed.lines);

    if (!check.ok) {
      return res.status(400).json({ ok: false, error: check.error });
    }

    descontarStock(stockData, parsed.lines);
    guardarStock(stockData);

    res.json({
      ok: true,
      message: "Enviado correctamente. Stock descontado.",
      subtotal: parsed.subtotal,
      discount: parsed.discount,
      total: parsed.total,
      data: datosPublicos()
    });
  });

  app.post("/api/stock/update", (req, res) => {
    if (!validarPin(req)) {
      return res.status(401).json({ ok: false, error: "PIN de administración incorrecto." });
    }

    const itemId = normalizarItemId(req.body?.itemId);
    const action = String(req.body?.action || "").trim().toLowerCase();
    const quantity = Math.floor(Number(req.body?.quantity || 0));
    const validIds = new Set(itemsCalculadora().map(item => item.id));

    if (!validIds.has(itemId)) {
      return res.status(400).json({ ok: false, error: "Servicio no válido." });
    }

    const data = cargarStock();
    const info = data.items[itemId];
    const now = new Date().toISOString();

    if (action === "set") {
      if (!Number.isFinite(quantity) || quantity < 0 || quantity > 999999) {
        return res.status(400).json({ ok: false, error: "Cantidad de stock no válida." });
      }

      info.stock = quantity;
    } else if (action === "unlimited") {
      info.stock = null;
    } else {
      return res.status(400).json({ ok: false, error: "Acción no válida." });
    }

    info.updatedAt = now;
    data.updatedAt = now;
    guardarStock(data);

    res.json({ ok: true, data: datosPublicos() });
  });

  app.get("/", (req, res) => {
    const initialData = JSON.stringify(datosPublicos()).replace(/</g, "\\u003c");

    res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Top Gear | Calculadora</title>

  <style>
    :root {
      --bg: #050807;
      --panel: rgba(15, 24, 19, .86);
      --border: rgba(255,255,255,.10);
      --border-strong: rgba(0,184,116,.40);
      --text: #f6fff9;
      --muted: #9fb1a8;
      --muted-2: #6f8178;
      --green: #00b875;
      --green-2: #087d53;
      --red: #c01718;
      --red-soft: rgba(192,23,24,.14);
      --button: #223127;
      --shadow: 0 28px 90px rgba(0,0,0,.45);
      --radius: 24px;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 12% 0%, rgba(0,184,116,.28), transparent 30%),
        radial-gradient(circle at 94% 10%, rgba(0,184,116,.13), transparent 36%),
        linear-gradient(135deg, #07110c 0%, #040706 58%, #07120d 100%);
      padding: 32px;
    }

    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
      background-size: 42px 42px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,.75), transparent 80%);
    }

    button,
    input {
      font: inherit;
    }

    button {
      border: 0;
      cursor: pointer;
      font-weight: 850;
      transition: transform .12s ease, border-color .12s ease, background .12s ease, opacity .12s ease;
    }

    button:active {
      transform: scale(.98);
    }

    button:disabled {
      opacity: .45;
      cursor: not-allowed;
    }

    .page {
      width: min(1260px, 100%);
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    .hero {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 24px;
      align-items: end;
      margin-bottom: 28px;
    }

    .eyebrow {
      margin: 0 0 10px;
      color: var(--green);
      font-size: 13px;
      font-weight: 950;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(34px, 5vw, 58px);
      line-height: .95;
      letter-spacing: -.055em;
    }

    .subtitle {
      width: min(760px, 100%);
      margin: 18px 0 0;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.6;
    }

    .hero-card {
      min-width: 270px;
      border: 1px solid var(--border);
      border-radius: 22px;
      padding: 18px;
      background: rgba(255,255,255,.045);
      backdrop-filter: blur(16px);
      box-shadow: var(--shadow);
    }

    .hero-card span {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 8px;
    }

    .hero-card strong {
      display: block;
      font-size: 30px;
      letter-spacing: -.045em;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 410px;
      gap: 24px;
      align-items: start;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: linear-gradient(180deg, var(--panel), rgba(9,14,11,.80));
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(18px);
    }

    .card-header {
      padding: 22px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
    }

    .card-header h2 {
      margin: 0;
      font-size: 20px;
      letter-spacing: -.02em;
    }

    .counter {
      color: var(--muted);
      font-size: 14px;
      font-weight: 750;
    }

    .services {
      padding: 18px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .service {
      min-height: 190px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 18px;
      padding: 18px;
      border: 1px solid var(--border);
      border-radius: 22px;
      background: rgba(255,255,255,.035);
    }

    .service.selected {
      border-color: var(--border-strong);
      background: linear-gradient(180deg, rgba(0,184,116,.12), rgba(255,255,255,.035));
    }

    .service-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }

    .service-name {
      font-size: 18px;
      font-weight: 950;
      letter-spacing: -.025em;
      margin-bottom: 8px;
    }

    .service-price,
    .service-stock {
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
      margin-top: 4px;
    }

    .quantity {
      min-width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(0,184,116,.24);
      border-radius: 14px;
      background: rgba(0,184,116,.09);
      color: var(--green);
      font-weight: 950;
      font-size: 16px;
    }

    .actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }

    .btn {
      min-height: 42px;
      border-radius: 13px;
      color: white;
    }

    .btn-add {
      background: linear-gradient(135deg, var(--green), var(--green-2));
    }

    .btn-remove {
      background: var(--red-soft);
      color: #ffd4d4;
      border: 1px solid rgba(192,23,24,.35);
    }

    .summary {
      position: sticky;
      top: 24px;
    }

    .summary-body {
      padding: 22px;
    }

    .metric {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
      color: var(--muted);
      font-size: 15px;
    }

    .metric strong {
      color: var(--text);
      font-size: 16px;
    }

    .section-title {
      margin: 20px 0 10px;
      color: var(--text);
      font-weight: 950;
      letter-spacing: -.02em;
    }

    .discounts {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 9px;
    }

    .discounts button {
      min-height: 44px;
      border-radius: 14px;
      background: var(--button);
      color: var(--text);
      border: 1px solid transparent;
    }

    .discounts button.active {
      background: linear-gradient(135deg, var(--green), var(--green-2));
      border-color: rgba(255,255,255,.14);
    }

    .selected-list {
      margin: 20px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 10px;
      max-height: 270px;
      overflow: auto;
      padding-right: 4px;
    }

    .selected-list li {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 12px;
      border-radius: 16px;
      background: rgba(255,255,255,.04);
      border: 1px solid var(--border);
    }

    .selected-list .name {
      color: var(--text);
      font-weight: 850;
      font-size: 14px;
    }

    .selected-list .qty {
      color: var(--muted);
      font-size: 13px;
      margin-top: 3px;
    }

    .empty {
      margin-top: 20px;
      padding: 16px;
      border-radius: 18px;
      border: 1px dashed rgba(255,255,255,.16);
      color: var(--muted);
      background: rgba(255,255,255,.03);
      line-height: 1.5;
      font-size: 14px;
    }

    .total {
      margin-top: 22px;
      padding: 20px;
      border-radius: 22px;
      background: linear-gradient(135deg, var(--green), #078354);
      box-shadow: 0 18px 50px rgba(0,184,116,.18);
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 16px;
    }

    .total span {
      color: rgba(255,255,255,.82);
      font-weight: 850;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: .10em;
    }

    .total strong {
      font-size: 32px;
      line-height: 1;
      letter-spacing: -.045em;
    }

    .summary-actions {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }

    .send {
      width: 100%;
      min-height: 50px;
      border-radius: 16px;
      background: linear-gradient(135deg, var(--green), var(--green-2));
      color: white;
    }

    .clear {
      width: 100%;
      min-height: 48px;
      border-radius: 16px;
      background: rgba(255,255,255,.055);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .clear:hover {
      border-color: rgba(192,23,24,.48);
      color: #ffdada;
      background: rgba(192,23,24,.12);
    }

    .stock-section {
      margin-top: 24px;
    }

    .stock-tools {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 10px;
      width: min(520px, 100%);
    }

    .input {
      width: 100%;
      min-height: 44px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,.055);
      color: var(--text);
      padding: 0 14px;
      outline: none;
    }

    .input:focus {
      border-color: rgba(0,184,116,.55);
    }

    .small-button {
      min-height: 44px;
      border-radius: 14px;
      color: var(--text);
      background: var(--button);
      border: 1px solid var(--border);
      padding: 0 16px;
    }

    .stock-list {
      padding: 18px;
      display: grid;
      gap: 12px;
    }

    .stock-row {
      display: grid;
      grid-template-columns: 1fr 120px 180px 112px;
      gap: 12px;
      align-items: center;
      padding: 14px;
      border: 1px solid var(--border);
      border-radius: 18px;
      background: rgba(255,255,255,.035);
    }

    .stock-name {
      font-weight: 900;
    }

    .stock-current {
      color: var(--muted);
      font-weight: 800;
    }

    .stock-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .stock-actions button {
      min-height: 40px;
      border-radius: 12px;
      color: white;
      background: var(--button);
      border: 1px solid var(--border);
    }

    .stock-actions button:first-child {
      background: linear-gradient(135deg, var(--green), var(--green-2));
    }

    .stock-actions button:last-child {
      background: var(--red-soft);
      color: #ffd4d4;
      border-color: rgba(192,23,24,.34);
    }

    .message {
      margin-top: 14px;
      display: none;
      border-radius: 16px;
      padding: 13px 14px;
      line-height: 1.45;
      font-size: 14px;
    }

    .message.ok {
      display: block;
      color: #d6ffed;
      background: rgba(0,184,116,.13);
      border: 1px solid rgba(0,184,116,.32);
    }

    .message.error {
      display: block;
      color: #ffd6d6;
      background: rgba(192,23,24,.13);
      border: 1px solid rgba(192,23,24,.32);
    }

    .footer {
      margin-top: 24px;
      color: var(--muted-2);
      text-align: center;
      font-size: 13px;
    }

    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: 1fr;
      }

      .summary {
        position: static;
      }

      .hero {
        grid-template-columns: 1fr;
      }

      .hero-card {
        width: fit-content;
      }
    }

    @media (max-width: 820px) {
      body {
        padding: 18px;
      }

      .services {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .stock-row {
        grid-template-columns: 1fr;
      }

      .stock-tools {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 560px) {
      .services {
        grid-template-columns: 1fr;
      }

      .card-header {
        align-items: flex-start;
        flex-direction: column;
      }

      .hero-card {
        width: 100%;
      }

      .discounts {
        grid-template-columns: repeat(2, 1fr);
      }
    }
  </style>
</head>

<body>
  <main class="page">
    <section class="hero">
      <div>
        <p class="eyebrow">Top Gear</p>
        <h1>Calculadora de servicios</h1>
        <p class="subtitle">Selecciona servicios, aplica descuentos y pulsa Enviar para descontar el stock.</p>
      </div>

      <div class="hero-card">
        <span>Total actual</span>
        <strong id="heroTotal">0${config.CURRENCY_SUFFIX || "$"}</strong>
      </div>
    </section>

    <section class="layout">
      <div class="card">
        <div class="card-header">
          <h2>Servicios disponibles</h2>
          <div class="counter" id="itemsCounter">0 servicios añadidos</div>
        </div>
        <div id="services" class="services"></div>
      </div>

      <aside class="card summary">
        <div class="card-header">
          <h2>Resumen</h2>
        </div>

        <div class="summary-body">
          <div class="metric">
            <span>Subtotal</span>
            <strong id="subtotal">0${config.CURRENCY_SUFFIX || "$"}</strong>
          </div>

          <div class="metric">
            <span>Descuento aplicado</span>
            <strong id="discountText">0%</strong>
          </div>

          <div class="section-title">Aplicar descuento</div>
          <div class="discounts" id="discounts"></div>

          <ul class="selected-list" id="selectedList"></ul>
          <div class="empty" id="emptyText">Todavía no hay servicios añadidos. Pulsa Añadir en cualquier servicio para empezar.</div>

          <div class="total">
            <span>Total</span>
            <strong id="total">0${config.CURRENCY_SUFFIX || "$"}</strong>
          </div>

          <div class="summary-actions">
            <button class="send" id="sendBtn">Enviar</button>
            <button class="clear" id="clearBtn">Limpiar</button>
          </div>

          <div id="mainMessage" class="message"></div>
        </div>
      </aside>
    </section>

    <section class="card stock-section">
      <div class="card-header">
        <div>
          <h2>Control de stock</h2>
          <div class="counter">Pon una cantidad o marca un servicio como sin límite.</div>
        </div>
        <div class="stock-tools">
          <input id="stockPin" class="input" type="password" placeholder="PIN de administración" />
          <button class="small-button" id="refreshBtn">Actualizar</button>
        </div>
      </div>

      <div id="stockList" class="stock-list"></div>

      <div style="padding: 0 18px 18px;">
        <div id="stockMessage" class="message"></div>
      </div>
    </section>

    <div class="footer">Top Gear · Calculadora y stock</div>
  </main>

  <script>
    let DATA = ${initialData};

    const state = {
      discount: 0,
      quantities: {}
    };

    const servicesEl = document.getElementById("services");
    const selectedListEl = document.getElementById("selectedList");
    const emptyTextEl = document.getElementById("emptyText");
    const subtotalEl = document.getElementById("subtotal");
    const totalEl = document.getElementById("total");
    const heroTotalEl = document.getElementById("heroTotal");
    const discountTextEl = document.getElementById("discountText");
    const clearBtn = document.getElementById("clearBtn");
    const sendBtn = document.getElementById("sendBtn");
    const discountsEl = document.getElementById("discounts");
    const itemsCounterEl = document.getElementById("itemsCounter");
    const stockListEl = document.getElementById("stockList");
    const stockPinEl = document.getElementById("stockPin");
    const refreshBtn = document.getElementById("refreshBtn");
    const mainMessageEl = document.getElementById("mainMessage");
    const stockMessageEl = document.getElementById("stockMessage");

    function money(value) {
      return new Intl.NumberFormat("es-ES").format(Math.round(Number(value) || 0)) + (DATA.currencySuffix || "$");
    }

    function quantityOf(itemId) {
      return Math.max(0, Math.floor(state.quantities[itemId] || 0));
    }

    function stockOf(itemId) {
      const info = DATA.stock && DATA.stock[itemId] ? DATA.stock[itemId] : { stock: null };
      return info.stock === null || info.stock === undefined ? null : Math.max(0, Math.floor(Number(info.stock) || 0));
    }

    function stockText(itemId) {
      const stock = stockOf(itemId);
      return stock === null ? "Stock: sin límite" : "Stock: " + stock;
    }

    function selectedItems() {
      return DATA.items
        .map(function(item) {
          return {
            id: item.id,
            label: item.label,
            price: item.price,
            quantity: quantityOf(item.id)
          };
        })
        .filter(function(item) {
          return item.quantity > 0;
        });
    }

    function totals() {
      const selected = selectedItems();

      const subtotal = selected.reduce(function(acc, item) {
        return acc + item.price * item.quantity;
      }, 0);

      const total = Math.round(subtotal * (1 - state.discount / 100));

      const quantity = selected.reduce(function(acc, item) {
        return acc + item.quantity;
      }, 0);

      return {
        selected: selected,
        subtotal: subtotal,
        total: total,
        quantity: quantity
      };
    }

    function setMessage(el, type, text) {
      el.className = "message" + (type ? " " + type : "");
      el.textContent = text || "";
      el.style.display = text ? "block" : "none";
    }

    function addItem(itemId) {
      const stock = stockOf(itemId);
      const current = quantityOf(itemId);

      if (stock !== null && current >= stock) {
        setMessage(mainMessageEl, "error", "No hay más stock disponible para este servicio.");
        return;
      }

      state.quantities[itemId] = current + 1;
      setMessage(mainMessageEl, "", "");
      render();
    }

    function removeItem(itemId) {
      const next = quantityOf(itemId) - 1;

      if (next > 0) state.quantities[itemId] = next;
      else delete state.quantities[itemId];

      render();
    }

    function renderDiscounts() {
      discountsEl.innerHTML = "";

      const discounts = [0].concat(DATA.discounts || [5, 10, 15])
        .map(Number)
        .filter(function(value, index, array) {
          return Number.isFinite(value) && value >= 0 && value <= 100 && array.indexOf(value) === index;
        })
        .slice(0, 6);

      discounts.forEach(function(discount) {
        const btn = document.createElement("button");
        btn.textContent = discount + "%";
        btn.className = state.discount === discount ? "active" : "";
        btn.onclick = function() {
          state.discount = discount;
          render();
        };
        discountsEl.appendChild(btn);
      });
    }

    function renderServices() {
      servicesEl.innerHTML = "";

      DATA.items.forEach(function(item) {
        const quantity = quantityOf(item.id);
        const stock = stockOf(item.id);

        const card = document.createElement("div");
        card.className = "service" + (quantity > 0 ? " selected" : "");

        const top = document.createElement("div");
        top.className = "service-top";

        const info = document.createElement("div");

        const name = document.createElement("div");
        name.className = "service-name";
        name.textContent = item.label;

        const price = document.createElement("div");
        price.className = "service-price";
        price.textContent = money(item.price);

        const stockLabel = document.createElement("div");
        stockLabel.className = "service-stock";
        stockLabel.textContent = stockText(item.id);

        info.appendChild(name);
        info.appendChild(price);
        info.appendChild(stockLabel);

        const qty = document.createElement("div");
        qty.className = "quantity";
        qty.textContent = quantity;

        top.appendChild(info);
        top.appendChild(qty);

        const actions = document.createElement("div");
        actions.className = "actions";

        const addBtn = document.createElement("button");
        addBtn.className = "btn btn-add";
        addBtn.textContent = "Añadir";
        addBtn.disabled = stock !== null && quantity >= stock;
        addBtn.onclick = function() {
          addItem(item.id);
        };

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn btn-remove";
        removeBtn.textContent = "Eliminar";
        removeBtn.disabled = quantity <= 0;
        removeBtn.onclick = function() {
          removeItem(item.id);
        };

        actions.appendChild(addBtn);
        actions.appendChild(removeBtn);

        card.appendChild(top);
        card.appendChild(actions);
        servicesEl.appendChild(card);
      });
    }

    function renderSummary() {
      const t = totals();

      subtotalEl.textContent = money(t.subtotal);
      totalEl.textContent = money(t.total);
      heroTotalEl.textContent = money(t.total);
      discountTextEl.textContent = state.discount + "%";
      itemsCounterEl.textContent = t.quantity === 1 ? "1 servicio añadido" : t.quantity + " servicios añadidos";

      selectedListEl.innerHTML = "";
      emptyTextEl.style.display = t.selected.length ? "none" : "block";

      t.selected.forEach(function(item) {
        const li = document.createElement("li");
        const left = document.createElement("div");

        const name = document.createElement("div");
        name.className = "name";
        name.textContent = item.label;

        const qty = document.createElement("div");
        qty.className = "qty";
        qty.textContent = "Cantidad: " + item.quantity;

        const amount = document.createElement("strong");
        amount.textContent = money(item.price * item.quantity);

        left.appendChild(name);
        left.appendChild(qty);
        li.appendChild(left);
        li.appendChild(amount);

        selectedListEl.appendChild(li);
      });

      sendBtn.disabled = !t.selected.length;
    }

    function renderStock() {
      stockListEl.innerHTML = "";

      DATA.items.forEach(function(item) {
        const row = document.createElement("div");
        row.className = "stock-row";

        const nameBox = document.createElement("div");

        const name = document.createElement("div");
        name.className = "stock-name";
        name.textContent = item.label;

        const price = document.createElement("div");
        price.className = "service-price";
        price.textContent = money(item.price);

        nameBox.appendChild(name);
        nameBox.appendChild(price);

        const current = document.createElement("div");
        current.className = "stock-current";
        current.textContent = stockOf(item.id) === null ? "Sin límite" : String(stockOf(item.id));

        const input = document.createElement("input");
        input.className = "input";
        input.type = "number";
        input.min = "0";
        input.placeholder = "Cantidad";
        input.value = stockOf(item.id) === null ? "" : String(stockOf(item.id));

        const actions = document.createElement("div");
        actions.className = "stock-actions";

        const saveBtn = document.createElement("button");
        saveBtn.textContent = "Guardar";
        saveBtn.onclick = function() {
          updateStock(item.id, "set", Number(input.value || 0));
        };

        const unlimitedBtn = document.createElement("button");
        unlimitedBtn.textContent = "Sin límite";
        unlimitedBtn.onclick = function() {
          updateStock(item.id, "unlimited", 0);
        };

        actions.appendChild(saveBtn);
        actions.appendChild(unlimitedBtn);

        row.appendChild(nameBox);
        row.appendChild(current);
        row.appendChild(input);
        row.appendChild(actions);

        stockListEl.appendChild(row);
      });
    }

    function render() {
      renderDiscounts();
      renderServices();
      renderSummary();
      renderStock();
    }

    async function reloadData() {
      const response = await fetch("/api/web-data");
      DATA = await response.json();

      Object.keys(state.quantities).forEach(function(itemId) {
        const stock = stockOf(itemId);

        if (stock !== null && state.quantities[itemId] > stock) {
          if (stock > 0) state.quantities[itemId] = stock;
          else delete state.quantities[itemId];
        }
      });

      render();
    }

    async function updateStock(itemId, action, quantity) {
      try {
        setMessage(stockMessageEl, "", "");

        const response = await fetch("/api/stock/update", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-pin": stockPinEl.value || ""
          },
          body: JSON.stringify({
            itemId: itemId,
            action: action,
            quantity: quantity
          })
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(result.error || "No se pudo actualizar el stock.");
        }

        DATA = result.data;
        setMessage(stockMessageEl, "ok", "Stock actualizado correctamente.");
        render();
      } catch (error) {
        setMessage(stockMessageEl, "error", error.message || "No se pudo actualizar el stock.");
      }
    }

    async function sendSelection() {
      try {
        const t = totals();

        if (!t.selected.length) {
          setMessage(mainMessageEl, "error", "Añade algún servicio antes de enviar.");
          return;
        }

        sendBtn.disabled = true;
        setMessage(mainMessageEl, "", "");

        const response = await fetch("/api/enviar", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            discount: state.discount,
            items: t.selected.map(function(item) {
              return {
                id: item.id,
                quantity: item.quantity
              };
            })
          })
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(result.error || "No se pudo enviar.");
        }

        DATA = result.data;
        state.quantities = {};
        state.discount = 0;

        setMessage(mainMessageEl, "ok", result.message || "Enviado correctamente. Stock descontado.");
        render();
      } catch (error) {
        setMessage(mainMessageEl, "error", error.message || "No se pudo enviar.");
        render();
      }
    }

    clearBtn.onclick = function() {
      state.discount = 0;
      state.quantities = {};
      setMessage(mainMessageEl, "", "");
      render();
    };

    sendBtn.onclick = sendSelection;
    refreshBtn.onclick = reloadData;

    render();
  </script>
</body>
</html>`);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Web calculadora activa en puerto ${PORT}`);
    console.log(`Archivo de stock web: ${stockFilePath()}`);
  });
}

module.exports = { iniciarWeb };
