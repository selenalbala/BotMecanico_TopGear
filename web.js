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
    version: 2,
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

  data.version = 2;
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

  const provided = String(
    req.headers["x-admin-pin"] ||
    req.body?.pin ||
    req.query?.pin ||
    ""
  ).trim();

  return provided === expected;
}

function datosStockPublico(data) {
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
    stock: datosStockPublico(stock),
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
      return { error: `La cantidad de ${item?.label || "un servicio"} no es válida.` };
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

function descontarStock(stockData, parsed) {
  const now = new Date().toISOString();

  for (const line of parsed.lines) {
    const info = stockData.items?.[line.id];
    if (!info || info.stock === null) continue;

    info.stock = Math.max(0, Math.floor((Number(info.stock) || 0) - line.quantity));
    info.updatedAt = now;
  }

  stockData.movements.unshift({
    id: `send_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: "send",
    createdAt: now,
    discount: parsed.discount,
    subtotal: parsed.subtotal,
    total: parsed.total,
    lines: parsed.lines
  });

  stockData.movements = stockData.movements.slice(0, 500);
  stockData.updatedAt = now;
}

function calcularConsumo(data, itemId, dias) {
  const fromMs = Date.now() - dias * 24 * 60 * 60 * 1000;
  let total = 0;

  for (const movement of data.movements || []) {
    if (movement.type !== "send") continue;

    const createdMs = new Date(movement.createdAt || 0).getTime();
    if (!Number.isFinite(createdMs) || createdMs < fromMs) continue;

    for (const line of movement.lines || []) {
      if (line.id === itemId) {
        total += Math.max(0, Math.floor(Number(line.quantity) || 0));
      }
    }
  }

  return total;
}

function calcularEntradas(data, itemId, dias) {
  const fromMs = Date.now() - dias * 24 * 60 * 60 * 1000;
  let total = 0;

  for (const movement of data.movements || []) {
    if (movement.type !== "order") continue;

    const createdMs = new Date(movement.createdAt || 0).getTime();
    if (!Number.isFinite(createdMs) || createdMs < fromMs) continue;

    if (movement.itemId === itemId) {
      total += Math.max(0, Math.floor(Number(movement.quantity) || 0));
    }
  }

  return total;
}

function resumenAdminStock() {
  const data = cargarStock();
  const items = itemsCalculadora();

  const rows = items.map(item => {
    const info = data.items[item.id] || { stock: null };
    const stock = info.stock === null ? null : Math.max(0, Math.floor(Number(info.stock) || 0));
    const consumed7 = calcularConsumo(data, item.id, 7);
    const consumed30 = calcularConsumo(data, item.id, 30);
    const ordered7 = calcularEntradas(data, item.id, 7);
    const safetyMin = Math.ceil(consumed7 * 1.30);
    const suggestedOrder = stock === null ? null : Math.max(0, safetyMin - stock);

    return {
      id: item.id,
      label: item.label,
      price: item.price,
      stock,
      updatedAt: info.updatedAt || null,
      consumed7,
      consumed30,
      ordered7,
      safetyMin,
      suggestedOrder,
      status: stock === null ? "unlimited" : (stock < safetyMin ? "low" : "ok")
    };
  });

  const movements = (data.movements || []).slice(0, 50);

  return {
    currencySuffix: config.CURRENCY_SUFFIX || "$",
    requiresPin: requierePin(),
    items: rows,
    movements,
    updatedAt: data.updatedAt || null
  };
}

function validarItemId(itemId) {
  const id = normalizarItemId(itemId);
  const validIds = new Set(itemsCalculadora().map(item => item.id));
  return validIds.has(id) ? id : "";
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

    descontarStock(stockData, parsed);
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

  app.post("/api/admin/login", (req, res) => {
    if (!validarPin(req)) {
      return res.status(401).json({ ok: false, error: "PIN incorrecto." });
    }

    res.json({ ok: true });
  });

  app.get("/api/admin/stock", (req, res) => {
    if (!validarPin(req)) {
      return res.status(401).json({ ok: false, error: "PIN incorrecto." });
    }

    res.json({ ok: true, data: resumenAdminStock() });
  });

  app.post("/api/admin/stock/update", (req, res) => {
    if (!validarPin(req)) {
      return res.status(401).json({ ok: false, error: "PIN incorrecto." });
    }

    const itemId = validarItemId(req.body?.itemId);
    const action = String(req.body?.action || "").trim().toLowerCase();
    const quantity = Math.floor(Number(req.body?.quantity || 0));

    if (!itemId) {
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

    data.movements.unshift({
      id: `adjust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: action === "unlimited" ? "unlimited" : "adjust",
      itemId,
      label: info.label,
      quantity: action === "unlimited" ? null : info.stock,
      createdAt: now
    });

    data.movements = data.movements.slice(0, 500);
    data.updatedAt = now;
    guardarStock(data);

    res.json({ ok: true, data: resumenAdminStock(), publicData: datosPublicos() });
  });

  app.post("/api/admin/orders/add", (req, res) => {
    if (!validarPin(req)) {
      return res.status(401).json({ ok: false, error: "PIN incorrecto." });
    }

    const itemId = validarItemId(req.body?.itemId);
    const quantity = Math.floor(Number(req.body?.quantity || 0));
    const note = String(req.body?.note || "").trim().slice(0, 180);

    if (!itemId) {
      return res.status(400).json({ ok: false, error: "Servicio no válido." });
    }

    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 999999) {
      return res.status(400).json({ ok: false, error: "Cantidad de pedido no válida." });
    }

    const data = cargarStock();
    const info = data.items[itemId];
    const now = new Date().toISOString();

    if (info.stock === null) info.stock = 0;
    info.stock = Math.floor((Number(info.stock) || 0) + quantity);
    info.updatedAt = now;

    data.movements.unshift({
      id: `order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type: "order",
      itemId,
      label: info.label,
      quantity,
      note,
      createdAt: now
    });

    data.movements = data.movements.slice(0, 500);
    data.updatedAt = now;
    guardarStock(data);

    res.json({ ok: true, message: "Pedido registrado. Stock actualizado.", data: resumenAdminStock(), publicData: datosPublicos() });
  });

  app.get("/stock", (req, res) => {
    const initial = JSON.stringify({
      requiresPin: requierePin(),
      items: itemsCalculadora()
    }).replace(/</g, "\\u003c");

    res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Top Gear | Control de stock</title>
  <style>
    :root {
      --bg: #050807;
      --panel: rgba(15, 24, 19, .88);
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
    input,
    select {
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

    a {
      color: inherit;
      text-decoration: none;
    }

    .page {
      width: min(1280px, 100%);
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 14px;
      margin-bottom: 26px;
    }

    .brand {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .eyebrow {
      margin: 0;
      color: var(--green);
      font-size: 13px;
      font-weight: 950;
      letter-spacing: .16em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(34px, 5vw, 56px);
      line-height: .95;
      letter-spacing: -.055em;
    }

    .subtitle {
      width: min(820px, 100%);
      margin: 14px 0 0;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.6;
    }

    .nav-button {
      min-height: 44px;
      border-radius: 14px;
      padding: 0 16px;
      background: rgba(255,255,255,.055);
      border: 1px solid var(--border);
      color: var(--text);
      display: inline-flex;
      align-items: center;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: linear-gradient(180deg, var(--panel), rgba(9,14,11,.82));
      box-shadow: var(--shadow);
      overflow: hidden;
      backdrop-filter: blur(18px);
      margin-bottom: 22px;
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

    .hint {
      color: var(--muted);
      font-size: 14px;
      line-height: 1.45;
      margin-top: 6px;
    }

    .body {
      padding: 22px;
    }

    .login {
      width: min(520px, 100%);
      margin: 40px auto;
    }

    .grid {
      display: grid;
      gap: 14px;
    }

    .input,
    .select {
      width: 100%;
      min-height: 46px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,.055);
      color: var(--text);
      padding: 0 14px;
      outline: none;
    }

    .select option {
      color: #0b120e;
    }

    .input:focus,
    .select:focus {
      border-color: rgba(0,184,116,.55);
    }

    .primary {
      min-height: 48px;
      border-radius: 16px;
      background: linear-gradient(135deg, var(--green), var(--green-2));
      color: white;
    }

    .secondary {
      min-height: 44px;
      border-radius: 14px;
      color: var(--text);
      background: var(--button);
      border: 1px solid var(--border);
      padding: 0 16px;
    }

    .danger {
      min-height: 44px;
      border-radius: 14px;
      background: var(--red-soft);
      color: #ffd4d4;
      border: 1px solid rgba(192,23,24,.35);
      padding: 0 16px;
    }

    .dashboard {
      display: none;
    }

    .dashboard.open {
      display: block;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 22px;
    }

    .stat {
      border: 1px solid var(--border);
      border-radius: 20px;
      background: rgba(255,255,255,.04);
      padding: 18px;
    }

    .stat span {
      display: block;
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 8px;
    }

    .stat strong {
      display: block;
      font-size: 28px;
      letter-spacing: -.045em;
    }

    .order-grid {
      display: grid;
      grid-template-columns: 1.2fr .5fr 1fr auto;
      gap: 12px;
      align-items: end;
    }

    .table-wrap {
      overflow: auto;
    }

    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0 10px;
      min-width: 980px;
    }

    th {
      text-align: left;
      color: var(--muted);
      font-size: 13px;
      font-weight: 850;
      padding: 0 12px;
    }

    td {
      background: rgba(255,255,255,.04);
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
      padding: 12px;
      vertical-align: middle;
    }

    td:first-child {
      border-left: 1px solid var(--border);
      border-top-left-radius: 16px;
      border-bottom-left-radius: 16px;
    }

    td:last-child {
      border-right: 1px solid var(--border);
      border-top-right-radius: 16px;
      border-bottom-right-radius: 16px;
    }

    .name {
      font-weight: 900;
    }

    .muted {
      color: var(--muted);
      font-size: 13px;
      margin-top: 4px;
    }

    .pill {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 30px;
      border-radius: 999px;
      padding: 0 10px;
      font-size: 13px;
      font-weight: 850;
      border: 1px solid var(--border);
      background: rgba(255,255,255,.055);
    }

    .pill.ok {
      color: #d6ffed;
      border-color: rgba(0,184,116,.32);
      background: rgba(0,184,116,.12);
    }

    .pill.low {
      color: #ffd6d6;
      border-color: rgba(192,23,24,.34);
      background: rgba(192,23,24,.13);
    }

    .row-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      min-width: 180px;
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

    .history {
      display: grid;
      gap: 10px;
    }

    .history-item {
      border: 1px solid var(--border);
      border-radius: 16px;
      background: rgba(255,255,255,.035);
      padding: 12px;
    }

    .history-title {
      font-weight: 900;
    }

    .history-text {
      color: var(--muted);
      font-size: 13px;
      margin-top: 5px;
      line-height: 1.45;
    }

    @media (max-width: 980px) {
      body {
        padding: 18px;
      }

      .topbar {
        align-items: flex-start;
        flex-direction: column;
      }

      .stats {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .order-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 560px) {
      .stats {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>

<body>
  <main class="page">
    <div class="topbar">
      <div class="brand">
        <p class="eyebrow">Top Gear</p>
        <h1>Control de stock</h1>
        <p class="subtitle">Registra los pedidos que haces, actualiza el stock y calcula el mínimo recomendado con un 30% de margen.</p>
      </div>

      <a class="nav-button" href="/">Volver a la calculadora</a>
    </div>

    <section class="card login" id="loginCard">
      <div class="card-header">
        <div>
          <h2>Acceso</h2>
          <div class="hint">Introduce el PIN de administración para modificar el stock.</div>
        </div>
      </div>

      <div class="body grid">
        <input id="pinInput" class="input" type="password" placeholder="PIN de administración" />
        <button id="loginBtn" class="primary">Entrar</button>
        <div id="loginMessage" class="message"></div>
      </div>
    </section>

    <section id="dashboard" class="dashboard">
      <div class="stats">
        <div class="stat">
          <span>Servicios controlados</span>
          <strong id="statItems">0</strong>
        </div>
        <div class="stat">
          <span>Stock bajo</span>
          <strong id="statLow">0</strong>
        </div>
        <div class="stat">
          <span>Unidades a pedir</span>
          <strong id="statOrder">0</strong>
        </div>
        <div class="stat">
          <span>Consumo 7 días</span>
          <strong id="statConsumed">0</strong>
        </div>
      </div>

      <section class="card">
        <div class="card-header">
          <div>
            <h2>Registrar pedido</h2>
            <div class="hint">Añade aquí lo que has comprado. La cantidad se suma al stock actual.</div>
          </div>
        </div>

        <div class="body">
          <div class="order-grid">
            <select id="orderItem" class="select"></select>
            <input id="orderQuantity" class="input" type="number" min="1" placeholder="Cantidad" />
            <input id="orderNote" class="input" placeholder="Nota opcional" />
            <button id="orderBtn" class="primary">Añadir al stock</button>
          </div>
          <div id="orderMessage" class="message"></div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2>Stock y recomendación semanal</h2>
            <div class="hint">Mínimo recomendado = consumo de los últimos 7 días + 30%. Pedir = mínimo recomendado - stock actual.</div>
          </div>
          <button id="refreshBtn" class="secondary">Actualizar</button>
        </div>

        <div class="body table-wrap">
          <table>
            <thead>
              <tr>
                <th>Servicio</th>
                <th>Stock actual</th>
                <th>Consumo 7 días</th>
                <th>Mínimo +30%</th>
                <th>Pedir semana siguiente</th>
                <th>Editar stock</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody id="stockRows"></tbody>
          </table>
          <div id="stockMessage" class="message"></div>
        </div>
      </section>

      <section class="card">
        <div class="card-header">
          <div>
            <h2>Últimos movimientos</h2>
            <div class="hint">Entradas por pedidos, ajustes manuales y salidas al pulsar Enviar en la calculadora.</div>
          </div>
        </div>

        <div class="body">
          <div id="history" class="history"></div>
        </div>
      </section>
    </section>
  </main>

  <script>
    const INITIAL = ${initial};
    let DATA = null;
    let PIN = localStorage.getItem("topgear_stock_pin") || "";

    const loginCard = document.getElementById("loginCard");
    const dashboard = document.getElementById("dashboard");
    const pinInput = document.getElementById("pinInput");
    const loginBtn = document.getElementById("loginBtn");
    const loginMessage = document.getElementById("loginMessage");

    const statItems = document.getElementById("statItems");
    const statLow = document.getElementById("statLow");
    const statOrder = document.getElementById("statOrder");
    const statConsumed = document.getElementById("statConsumed");

    const orderItem = document.getElementById("orderItem");
    const orderQuantity = document.getElementById("orderQuantity");
    const orderNote = document.getElementById("orderNote");
    const orderBtn = document.getElementById("orderBtn");
    const orderMessage = document.getElementById("orderMessage");

    const refreshBtn = document.getElementById("refreshBtn");
    const stockRows = document.getElementById("stockRows");
    const stockMessage = document.getElementById("stockMessage");
    const historyEl = document.getElementById("history");

    function setMessage(el, type, text) {
      el.className = "message" + (type ? " " + type : "");
      el.textContent = text || "";
      el.style.display = text ? "block" : "none";
    }

    function money(value) {
      return new Intl.NumberFormat("es-ES").format(Math.round(Number(value) || 0)) + ((DATA && DATA.currencySuffix) || "$");
    }

    function fmtDate(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleString("es-ES", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    function statusLabel(item) {
      if (item.status === "unlimited") return "Sin límite";
      if (item.status === "low") return "Stock bajo";
      return "Correcto";
    }

    function renderOrderOptions() {
      orderItem.innerHTML = "";

      (DATA.items || []).forEach(function(item) {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.label;
        orderItem.appendChild(option);
      });
    }

    function renderStats() {
      const items = DATA.items || [];
      const controlled = items.filter(function(item) { return item.stock !== null; }).length;
      const low = items.filter(function(item) { return item.status === "low"; }).length;
      const toOrder = items.reduce(function(acc, item) { return acc + (Number(item.suggestedOrder) || 0); }, 0);
      const consumed = items.reduce(function(acc, item) { return acc + (Number(item.consumed7) || 0); }, 0);

      statItems.textContent = controlled;
      statLow.textContent = low;
      statOrder.textContent = toOrder;
      statConsumed.textContent = consumed;
    }

    function renderRows() {
      stockRows.innerHTML = "";

      (DATA.items || []).forEach(function(item) {
        const tr = document.createElement("tr");

        const serviceTd = document.createElement("td");
        const name = document.createElement("div");
        name.className = "name";
        name.textContent = item.label;
        const price = document.createElement("div");
        price.className = "muted";
        price.textContent = money(item.price);
        serviceTd.appendChild(name);
        serviceTd.appendChild(price);

        const stockTd = document.createElement("td");
        stockTd.textContent = item.stock === null ? "Sin límite" : String(item.stock);

        const consumedTd = document.createElement("td");
        consumedTd.textContent = String(item.consumed7);

        const minTd = document.createElement("td");
        minTd.textContent = item.stock === null ? "-" : String(item.safetyMin);

        const orderTd = document.createElement("td");
        orderTd.textContent = item.stock === null ? "-" : String(item.suggestedOrder);

        const editTd = document.createElement("td");
        const actions = document.createElement("div");
        actions.className = "row-actions";

        const input = document.createElement("input");
        input.className = "input";
        input.type = "number";
        input.min = "0";
        input.value = item.stock === null ? "" : String(item.stock);
        input.placeholder = "Stock";

        const saveBtn = document.createElement("button");
        saveBtn.className = "primary";
        saveBtn.textContent = "Guardar";
        saveBtn.onclick = function() {
          updateStock(item.id, "set", Number(input.value || 0));
        };

        const unlimitedBtn = document.createElement("button");
        unlimitedBtn.className = "danger";
        unlimitedBtn.textContent = "Sin límite";
        unlimitedBtn.onclick = function() {
          updateStock(item.id, "unlimited", 0);
        };

        actions.appendChild(saveBtn);
        actions.appendChild(unlimitedBtn);
        editTd.appendChild(input);
        editTd.appendChild(actions);

        const statusTd = document.createElement("td");
        const pill = document.createElement("span");
        pill.className = "pill " + (item.status === "low" ? "low" : "ok");
        pill.textContent = statusLabel(item);
        statusTd.appendChild(pill);

        tr.appendChild(serviceTd);
        tr.appendChild(stockTd);
        tr.appendChild(consumedTd);
        tr.appendChild(minTd);
        tr.appendChild(orderTd);
        tr.appendChild(editTd);
        tr.appendChild(statusTd);

        stockRows.appendChild(tr);
      });
    }

    function movementText(movement) {
      if (movement.type === "order") {
        return "Pedido registrado: " + movement.label + " +" + movement.quantity + (movement.note ? " · " + movement.note : "");
      }

      if (movement.type === "send") {
        const lines = (movement.lines || []).map(function(line) {
          return line.label + " x" + line.quantity;
        }).join(", ");

        return "Salida por Enviar: " + lines;
      }

      if (movement.type === "adjust") {
        return "Ajuste manual: " + movement.label + " = " + movement.quantity;
      }

      if (movement.type === "unlimited") {
        return "Marcado como sin límite: " + movement.label;
      }

      return "Movimiento de stock";
    }

    function renderHistory() {
      historyEl.innerHTML = "";

      const movements = DATA.movements || [];

      if (!movements.length) {
        const empty = document.createElement("div");
        empty.className = "history-item";
        empty.textContent = "Todavía no hay movimientos.";
        historyEl.appendChild(empty);
        return;
      }

      movements.slice(0, 30).forEach(function(movement) {
        const item = document.createElement("div");
        item.className = "history-item";

        const title = document.createElement("div");
        title.className = "history-title";
        title.textContent = movementText(movement);

        const text = document.createElement("div");
        text.className = "history-text";
        text.textContent = fmtDate(movement.createdAt);

        item.appendChild(title);
        item.appendChild(text);
        historyEl.appendChild(item);
      });
    }

    function render() {
      renderOrderOptions();
      renderStats();
      renderRows();
      renderHistory();
    }

    async function loadAdminData() {
      const response = await fetch("/api/admin/stock", {
        headers: {
          "x-admin-pin": PIN
        }
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        localStorage.removeItem("topgear_stock_pin");
        throw new Error(result.error || "No se pudo cargar el stock.");
      }

      DATA = result.data;
      loginCard.style.display = "none";
      dashboard.classList.add("open");
      render();
    }

    async function login() {
      try {
        setMessage(loginMessage, "", "");
        PIN = pinInput.value || "";

        const response = await fetch("/api/admin/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            pin: PIN
          })
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(result.error || "PIN incorrecto.");
        }

        localStorage.setItem("topgear_stock_pin", PIN);
        await loadAdminData();
      } catch (error) {
        setMessage(loginMessage, "error", error.message || "No se pudo iniciar sesión.");
      }
    }

    async function updateStock(itemId, action, quantity) {
      try {
        setMessage(stockMessage, "", "");

        const response = await fetch("/api/admin/stock/update", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-pin": PIN
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
        setMessage(stockMessage, "ok", "Stock actualizado correctamente.");
        render();
      } catch (error) {
        setMessage(stockMessage, "error", error.message || "No se pudo actualizar el stock.");
      }
    }

    async function addOrder() {
      try {
        setMessage(orderMessage, "", "");

        const response = await fetch("/api/admin/orders/add", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-pin": PIN
          },
          body: JSON.stringify({
            itemId: orderItem.value,
            quantity: Number(orderQuantity.value || 0),
            note: orderNote.value || ""
          })
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
          throw new Error(result.error || "No se pudo registrar el pedido.");
        }

        DATA = result.data;
        orderQuantity.value = "";
        orderNote.value = "";
        setMessage(orderMessage, "ok", result.message || "Pedido registrado. Stock actualizado.");
        render();
      } catch (error) {
        setMessage(orderMessage, "error", error.message || "No se pudo registrar el pedido.");
      }
    }

    loginBtn.onclick = login;
    orderBtn.onclick = addOrder;
    refreshBtn.onclick = loadAdminData;

    pinInput.addEventListener("keydown", function(event) {
      if (event.key === "Enter") login();
    });

    orderQuantity.addEventListener("keydown", function(event) {
      if (event.key === "Enter") addOrder();
    });

    if (!INITIAL.requiresPin) {
      PIN = "";
      loadAdminData().catch(function(error) {
        setMessage(loginMessage, "error", error.message || "No se pudo cargar el stock.");
      });
    } else if (PIN) {
      pinInput.value = PIN;
      loadAdminData().catch(function() {
        loginCard.style.display = "block";
        dashboard.classList.remove("open");
      });
    }
  </script>
</body>
</html>`);
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

    * { box-sizing: border-box; }

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

    button, input { font: inherit; }

    button {
      border: 0;
      cursor: pointer;
      font-weight: 850;
      transition: transform .12s ease, border-color .12s ease, background .12s ease, opacity .12s ease;
    }

    button:active { transform: scale(.98); }
    button:disabled { opacity: .45; cursor: not-allowed; }

    a {
      color: inherit;
      text-decoration: none;
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

    .hero-actions {
      display: flex;
      gap: 10px;
      margin-top: 18px;
      flex-wrap: wrap;
    }

    .link-button {
      min-height: 44px;
      border-radius: 14px;
      padding: 0 16px;
      background: rgba(255,255,255,.055);
      border: 1px solid var(--border);
      color: var(--text);
      display: inline-flex;
      align-items: center;
      font-weight: 850;
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
      .layout { grid-template-columns: 1fr; }
      .summary { position: static; }
      .hero { grid-template-columns: 1fr; }
      .hero-card { width: fit-content; }
    }

    @media (max-width: 820px) {
      body { padding: 18px; }
      .services { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 560px) {
      .services { grid-template-columns: 1fr; }
      .card-header { align-items: flex-start; flex-direction: column; }
      .hero-card { width: 100%; }
      .discounts { grid-template-columns: repeat(2, 1fr); }
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
        <div class="hero-actions">
          <a class="link-button" href="/stock">Control de stock</a>
        </div>
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
    const mainMessageEl = document.getElementById("mainMessage");

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

    function render() {
      renderDiscounts();
      renderServices();
      renderSummary();
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
        await reloadData().catch(function() {});
      }
    }

    clearBtn.onclick = function() {
      state.discount = 0;
      state.quantities = {};
      setMessage(mainMessageEl, "", "");
      render();
    };

    sendBtn.onclick = sendSelection;

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
