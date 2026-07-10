const express = require("express");
const config = require("./config");

function iniciarWeb() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

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
    :root {
      --bg: #050807;
      --panel: rgba(15, 24, 19, .82);
      --panel-2: rgba(20, 32, 25, .72);
      --border: rgba(255, 255, 255, .10);
      --border-strong: rgba(0, 184, 116, .42);
      --text: #f5fff9;
      --muted: #9fb1a8;
      --muted-2: #718178;
      --green: #00b875;
      --green-2: #068b5d;
      --red: #c01718;
      --red-2: #7e1517;
      --dark-button: #213026;
      --shadow: 0 24px 80px rgba(0, 0, 0, .42);
      --radius: 24px;
    }

    * {
      box-sizing: border-box;
    }

    html {
      scroll-behavior: smooth;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      background:
        radial-gradient(circle at 12% 0%, rgba(0, 184, 116, .28), transparent 30%),
        radial-gradient(circle at 95% 12%, rgba(0, 184, 116, .12), transparent 34%),
        linear-gradient(135deg, #07110c 0%, #040706 54%, #07120d 100%);
      color: var(--text);
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
      mask-image: linear-gradient(to bottom, rgba(0,0,0,.75), transparent 78%);
    }

    button {
      border: 0;
      cursor: pointer;
      font-family: inherit;
      font-weight: 800;
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
      width: min(1240px, 100%);
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
      font-weight: 900;
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
      width: min(720px, 100%);
      margin: 18px 0 0;
      color: var(--muted);
      font-size: 17px;
      line-height: 1.6;
    }

    .hero-card {
      min-width: 250px;
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
      font-size: 28px;
      letter-spacing: -.04em;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 390px;
      gap: 24px;
      align-items: start;
    }

    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      background: linear-gradient(180deg, var(--panel), rgba(9, 14, 11, .78));
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
      font-weight: 700;
    }

    .services {
      padding: 18px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }

    .service {
      min-height: 178px;
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
      background:
        linear-gradient(180deg, rgba(0, 184, 116, .12), rgba(255,255,255,.035));
    }

    .service-top {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }

    .service-name {
      font-size: 18px;
      font-weight: 900;
      letter-spacing: -.025em;
      margin-bottom: 8px;
    }

    .service-price {
      color: var(--muted);
      font-size: 14px;
      font-weight: 700;
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
      font-weight: 900;
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
      background: rgba(192, 23, 24, .14);
      color: #ffd4d4;
      border: 1px solid rgba(192, 23, 24, .35);
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

    .discount-title {
      margin: 20px 0 10px;
      color: var(--text);
      font-weight: 900;
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
      background: var(--dark-button);
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
      max-height: 300px;
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
      font-weight: 800;
      font-size: 14px;
    }

    .selected-list .qty {
      color: var(--muted);
      font-size: 13px;
      margin-top: 3px;
    }

    .selected-list strong {
      font-size: 14px;
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
      box-shadow: 0 18px 50px rgba(0, 184, 116, .18);
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 16px;
    }

    .total span {
      color: rgba(255,255,255,.82);
      font-weight: 800;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: .10em;
    }

    .total strong {
      font-size: 32px;
      line-height: 1;
      letter-spacing: -.045em;
    }

    .clear {
      width: 100%;
      min-height: 48px;
      margin-top: 14px;
      border-radius: 16px;
      background: rgba(255,255,255,.055);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .clear:hover {
      border-color: rgba(192, 23, 24, .48);
      color: #ffdada;
      background: rgba(192, 23, 24, .12);
    }

    .footer {
      margin-top: 24px;
      color: var(--muted-2);
      text-align: center;
      font-size: 13px;
    }

    @media (max-width: 1060px) {
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

    @media (max-width: 760px) {
      body {
        padding: 18px;
      }

      .services {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 540px) {
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
        <p class="subtitle">
          Selecciona las mejoras, reparaciones o extras que necesita el vehículo y aplica el descuento correspondiente.
        </p>
      </div>

      <div class="hero-card">
        <span>Total actual</span>
        <strong id="heroTotal">0${currencySuffix}</strong>
      </div>
    </section>

    <section class="layout">
      <div class="card">
        <div class="card-header">
          <h2>Servicios disponibles</h2>
          <div class="counter" id="itemsCounter">0 seleccionados</div>
        </div>

        <div id="services" class="services"></div>
      </div>

      <aside class="card summary">
        <div class="card-header">
          <h2>Resumen del presupuesto</h2>
        </div>

        <div class="summary-body">
          <div class="metric">
            <span>Subtotal</span>
            <strong id="subtotal">0${currencySuffix}</strong>
          </div>

          <div class="metric">
            <span>Descuento aplicado</span>
            <strong id="discountText">0%</strong>
          </div>

          <div class="discount-title">Aplicar descuento</div>
          <div class="discounts" id="discounts"></div>

          <ul class="selected-list" id="selectedList"></ul>
          <div class="empty" id="emptyText">
            Todavía no hay servicios añadidos. Pulsa Añadir en cualquier servicio para empezar.
          </div>

          <div class="total">
            <div>
              <span>Total</span>
            </div>
            <strong id="total">0${currencySuffix}</strong>
          </div>

          <button class="clear" id="clearBtn">Limpiar presupuesto</button>
        </div>
      </aside>
    </section>

    <div class="footer">Top Gear · Calculadora de servicios</div>
  </main>

  <script>
    const ITEMS = ${itemsJson};
    const RAW_DISCOUNTS = ${discountsJson};
    const DISCOUNTS = [0, ...RAW_DISCOUNTS]
      .filter((value, index, array) => Number.isFinite(Number(value)) && array.indexOf(value) === index)
      .map(Number)
      .slice(0, 6);

    const CURRENCY_SUFFIX = ${JSON.stringify(currencySuffix)};

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
    const discountsEl = document.getElementById("discounts");
    const itemsCounterEl = document.getElementById("itemsCounter");

    function money(value) {
      return new Intl.NumberFormat("es-ES").format(value) + CURRENCY_SUFFIX;
    }

    function quantityOf(itemId) {
      return Math.max(0, Math.floor(state.quantities[itemId] || 0));
    }

    function selectedItems() {
      return ITEMS
        .map(item => ({
          ...item,
          quantity: quantityOf(item.id)
        }))
        .filter(item => item.quantity > 0);
    }

    function totals() {
      const selected = selectedItems();
      const subtotal = selected.reduce((acc, item) => acc + item.price * item.quantity, 0);
      const total = Math.round(subtotal * (1 - state.discount / 100));
      const quantity = selected.reduce((acc, item) => acc + item.quantity, 0);
      return { selected, subtotal, total, quantity };
    }

    function addItem(itemId) {
      state.quantities[itemId] = quantityOf(itemId) + 1;
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
        const quantity = quantityOf(item.id);

        const card = document.createElement("div");
        card.className = "service" + (quantity > 0 ? " selected" : "");

        const top = document.createElement("div");
        top.className = "service-top";

        const info = document.createElement("div");
        info.innerHTML = `
          <div class="service-name">${item.label}</div>
          <div class="service-price">${money(item.price)}</div>
        `;

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
        addBtn.onclick = () => addItem(item.id);

        const removeBtn = document.createElement("button");
        removeBtn.className = "btn btn-remove";
        removeBtn.textContent = "Eliminar";
        removeBtn.disabled = quantity <= 0;
        removeBtn.onclick = () => removeItem(item.id);

        actions.appendChild(addBtn);
        actions.appendChild(removeBtn);

        card.appendChild(top);
        card.appendChild(actions);
        servicesEl.appendChild(card);
      });
    }

    function renderSummary() {
      const { selected, subtotal, total, quantity } = totals();

      subtotalEl.textContent = money(subtotal);
      totalEl.textContent = money(total);
      heroTotalEl.textContent = money(total);
      discountTextEl.textContent = state.discount + "%";
      itemsCounterEl.textContent = quantity === 1 ? "1 servicio añadido" : quantity + " servicios añadidos";

      selectedListEl.innerHTML = "";
      emptyTextEl.style.display = selected.length ? "none" : "block";

      selected.forEach(item => {
        const li = document.createElement("li");
        li.innerHTML = `
          <div>
            <div class="name">${item.label}</div>
            <div class="qty">Cantidad: ${item.quantity}</div>
          </div>
          <strong>${money(item.price * item.quantity)}</strong>
        `;
        selectedListEl.appendChild(li);
      });
    }

    function render() {
      renderDiscounts();
      renderServices();
      renderSummary();
    }

    clearBtn.onclick = () => {
      state.discount = 0;
      state.quantities = {};
      render();
    };

    render();
  </script>
</body>
</html>`);
  });

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Web calculadora activa en puerto ${PORT}`);
  });
}

module.exports = { iniciarWeb };
