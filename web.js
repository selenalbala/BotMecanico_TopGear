const express = require("express");
const config = require("./config");

function iniciarWeb() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.get("/api/calculadora", (req, res) => {
    res.json({
      currencySuffix: config.CURRENCY_SUFFIX || "$",
      discounts: config.CALCULATOR_DISCOUNTS?.length ? config.CALCULATOR_DISCOUNTS : [0, 5, 10, 15],
      items: config.CALCULATOR_ITEMS || []
    });
  });

  app.get("/", (req, res) => {
    const itemsJson = JSON.stringify(config.CALCULATOR_ITEMS || []);
    const discountsJson = JSON.stringify(config.CALCULATOR_DISCOUNTS?.length ? config.CALCULATOR_DISCOUNTS : [0, 5, 10, 15]);
    const currencySuffix = config.CURRENCY_SUFFIX || "$";

    res.send(`<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Top Gear | Calculadora</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, Helvetica, sans-serif;
      background: radial-gradient(circle at top left, rgba(0,168,107,.28), transparent 34%),
                  radial-gradient(circle at bottom right, rgba(0,168,107,.12), transparent 40%),
                  #070b09;
      color: #f5fff8;
      padding: 24px;
    }

    .page {
      max-width: 1180px;
      margin: 0 auto;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      margin-bottom: 22px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
    }

    .logo {
      width: 54px;
      height: 54px;
      border-radius: 16px;
      background: linear-gradient(145deg, #00A86B, #064f36);
      display: grid;
      place-items: center;
      font-size: 28px;
      box-shadow: 0 22px 70px rgba(0,0,0,.45);
    }

    h1 {
      margin: 0;
      font-size: 30px;
    }

    .subtitle {
      margin-top: 6px;
      color: #a7b8ad;
      font-size: 14px;
    }

    .badge {
      border: 1px solid rgba(255,255,255,.09);
      background: rgba(255,255,255,.04);
      color: #a7b8ad;
      padding: 10px 14px;
      border-radius: 999px;
      font-size: 14px;
    }

    .layout {
      display: grid;
      grid-template-columns: 1fr 370px;
      gap: 22px;
      align-items: start;
    }

    .card {
      background: linear-gradient(180deg, rgba(255,255,255,.045), rgba(255,255,255,.02));
      border: 1px solid rgba(255,255,255,.09);
      border-radius: 24px;
      box-shadow: 0 22px 70px rgba(0,0,0,.45);
      overflow: hidden;
    }

    .card-title {
      padding: 20px 22px;
      border-bottom: 1px solid rgba(255,255,255,.09);
      background: rgba(255,255,255,.025);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
    }

    .card-title h2 {
      margin: 0;
      font-size: 18px;
    }

    .mode {
      display: flex;
      gap: 8px;
    }

    button {
      border: 0;
      cursor: pointer;
      border-radius: 12px;
      font-weight: 700;
      transition: transform .08s ease, opacity .08s ease, background .08s ease;
    }

    button:active {
      transform: scale(.98);
    }

    .mode button {
      padding: 10px 12px;
      color: white;
      background: #2b352e;
    }

    .mode button.active-add {
      background: #00A86B;
    }

    .mode button.active-remove {
      background: #c01718;
    }

    .services {
      padding: 18px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .service {
      background: #101812;
      border: 1px solid rgba(255,255,255,.09);
      border-radius: 18px;
      padding: 14px;
      min-height: 118px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 12px;
    }

    .service.selected {
      border-color: rgba(0,168,107,.75);
      background: linear-gradient(180deg, rgba(0,168,107,.13), rgba(255,255,255,.025));
    }

    .service-name {
      font-size: 16px;
      font-weight: 800;
    }

    .service-price {
      color: #a7b8ad;
      margin-top: 5px;
      font-size: 14px;
    }

    .qty {
      color: #00A86B;
      font-weight: 800;
      font-size: 13px;
      margin-top: 7px;
    }

    .service button {
      width: 100%;
      padding: 11px;
      background: #263128;
      color: white;
    }

    .service.selected button {
      background: #00A86B;
    }

    .summary {
      position: sticky;
      top: 20px;
    }

    .summary-body {
      padding: 20px;
    }

    .line {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 11px 0;
      border-bottom: 1px solid rgba(255,255,255,.09);
      color: #a7b8ad;
    }

    .line strong {
      color: #f5fff8;
    }

    .total {
      margin-top: 18px;
      padding: 18px;
      border-radius: 18px;
      background: linear-gradient(145deg, #00A86B, #04764d);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-weight: 900;
      font-size: 24px;
    }

    .selected-list {
      margin: 16px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 8px;
    }

    .selected-list li {
      background: rgba(255,255,255,.04);
      border: 1px solid rgba(255,255,255,.09);
      padding: 10px 12px;
      border-radius: 12px;
      color: #a7b8ad;
      font-size: 14px;
      display: flex;
      justify-content: space-between;
      gap: 8px;
    }

    .discounts {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      margin-top: 16px;
    }

    .discounts button {
      padding: 11px 8px;
      background: #263128;
      color: white;
    }

    .discounts button.active {
      background: #00A86B;
    }

    .clear {
      width: 100%;
      margin-top: 14px;
      padding: 13px;
      background: rgba(192,23,24,.18);
      color: #ffb8b8;
      border: 1px solid rgba(192,23,24,.35);
    }

    .empty {
      color: #a7b8ad;
      background: rgba(255,255,255,.035);
      border: 1px dashed rgba(255,255,255,.09);
      border-radius: 16px;
      padding: 14px;
      font-size: 14px;
      margin-top: 16px;
    }

    @media (max-width: 920px) {
      body {
        padding: 14px;
      }

      .header {
        align-items: flex-start;
        flex-direction: column;
      }

      .layout {
        grid-template-columns: 1fr;
      }

      .summary {
        position: static;
      }

      .services {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 560px) {
      .services {
        grid-template-columns: 1fr;
      }

      .card-title {
        align-items: flex-start;
        flex-direction: column;
      }

      h1 {
        font-size: 25px;
      }
    }
  </style>
</head>

<body>
  <main class="page">
    <header class="header">
      <div class="brand">
        <div class="logo">🏁</div>
        <div>
          <h1>Top Gear | Calculadora</h1>
          <div class="subtitle">Calcula mejoras, reparaciones y descuentos desde la web.</div>
        </div>
      </div>
      <div class="badge">Web Railway · Precios sincronizados</div>
    </header>

    <section class="layout">
      <div class="card">
        <div class="card-title">
          <h2>Servicios</h2>
          <div class="mode">
            <button id="addBtn" class="active-add">Añadir</button>
            <button id="removeBtn">Quitar</button>
          </div>
        </div>

        <div id="services" class="services"></div>
      </div>

      <aside class="card summary">
        <div class="card-title">
          <h2>Resumen</h2>
        </div>

        <div class="summary-body">
          <div class="line">
            <span>Modo</span>
            <strong id="modeText">Añadir</strong>
          </div>

          <div class="line">
            <span>Subtotal</span>
            <strong id="subtotal">0${currencySuffix}</strong>
          </div>

          <div class="line">
            <span>Descuento</span>
            <strong id="discountText">0%</strong>
          </div>

          <div class="discounts" id="discounts"></div>

          <ul class="selected-list" id="selectedList"></ul>
          <div class="empty" id="emptyText">No hay servicios añadidos todavía.</div>

          <div class="total">
            <span>Total</span>
            <span id="total">0${currencySuffix}</span>
          </div>

          <button class="clear" id="clearBtn">Limpiar calculadora</button>
        </div>
      </aside>
    </section>
  </main>

  <script>
    const ITEMS = ${itemsJson};
    const DISCOUNTS = [0, ...${discountsJson}]
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .slice(0, 4);

    const CURRENCY_SUFFIX = ${JSON.stringify(currencySuffix)};

    const state = {
      mode: "add",
      discount: 0,
      quantities: {}
    };

    const servicesEl = document.getElementById("services");
    const selectedListEl = document.getElementById("selectedList");
    const emptyTextEl = document.getElementById("emptyText");
    const subtotalEl = document.getElementById("subtotal");
    const totalEl = document.getElementById("total");
    const discountTextEl = document.getElementById("discountText");
    const modeTextEl = document.getElementById("modeText");
    const addBtn = document.getElementById("addBtn");
    const removeBtn = document.getElementById("removeBtn");
    const clearBtn = document.getElementById("clearBtn");
    const discountsEl = document.getElementById("discounts");

    function money(value) {
      return new Intl.NumberFormat("es-ES").format(value) + CURRENCY_SUFFIX;
    }

    function selectedItems() {
      return ITEMS
        .map(item => ({
          ...item,
          quantity: Math.max(0, Math.floor(state.quantities[item.id] || 0))
        }))
        .filter(item => item.quantity > 0);
    }

    function renderDiscounts() {
      discountsEl.innerHTML = "";

      DISCOUNTS.forEach(discount => {
        const btn = document.createElement("button");
        btn.textContent = discount + "%";
        btn.className = state.discount === discount ? "active" : "";

        btn.onclick = () => {
          state.discount = discount;
          render();
        };

        discountsEl.appendChild(btn);
      });
    }

    function renderServices() {
      servicesEl.innerHTML = "";

      ITEMS.forEach(item => {
        const quantity = Math.max(0, Math.floor(state.quantities[item.id] || 0));
        const card = document.createElement("div");
        card.className = "service" + (quantity > 0 ? " selected" : "");

        const info = document.createElement("div");
        info.innerHTML = \`
          <div class="service-name">\${item.label}</div>
          <div class="service-price">\${money(item.price)}</div>
          \${quantity > 0 ? \`<div class="qty">Añadido x\${quantity}</div>\` : ""}
        \`;

        const btn = document.createElement("button");
        btn.textContent = quantity > 0 ? "Actualizar" : "Seleccionar";

        btn.onclick = () => {
          const current = Math.max(0, Math.floor(state.quantities[item.id] || 0));

          if (state.mode === "remove") {
            const next = Math.max(0, current - 1);
            if (next > 0) state.quantities[item.id] = next;
            else delete state.quantities[item.id];
          } else {
            state.quantities[item.id] = current + 1;
          }

          render();
        };

        card.appendChild(info);
        card.appendChild(btn);
        servicesEl.appendChild(card);
      });
    }

    function renderSummary() {
      const selected = selectedItems();
      const subtotal = selected.reduce((acc, item) => acc + item.price * item.quantity, 0);
      const total = Math.round(subtotal * (1 - state.discount / 100));

      subtotalEl.textContent = money(subtotal);
      totalEl.textContent = money(total);
      discountTextEl.textContent = state.discount + "%";
      modeTextEl.textContent = state.mode === "remove" ? "Quitar" : "Añadir";

      addBtn.className = state.mode === "add" ? "active-add" : "";
      removeBtn.className = state.mode === "remove" ? "active-remove" : "";

      selectedListEl.innerHTML = "";
      emptyTextEl.style.display = selected.length ? "none" : "block";

      selected.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = \`
          <span>\${item.label} x\${item.quantity}</span>
          <strong>\${money(item.price * item.quantity)}</strong>
        \`;
        selectedListEl.appendChild(li);
      });
    }

    function render() {
      renderDiscounts();
      renderServices();
      renderSummary();
    }

    addBtn.onclick = () => {
      state.mode = "add";
      render();
    };

    removeBtn.onclick = () => {
      state.mode = "remove";
      render();
    };

    clearBtn.onclick = () => {
      state.mode = "add";
      state.discount = 0;
      state.quantities = {};
      render();
    };

    render();
  </script>
</body>
</html>`);
  });

  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Web calculadora activa en puerto ${PORT}`);
  });
}

module.exports = { iniciarWeb };