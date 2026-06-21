function env(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return String(value).trim();
}

function envList(name, fallback = "") {
  return env(name, fallback)
    .split(/[;,\s]+/g)
    .map(value => value.trim())
    .filter(Boolean);
}

function envBool(name, fallback = false) {
  const value = env(name, "").toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "si", "sí", "on"].includes(value);
}

function envNumber(name, fallback = 0) {
  const value = Number(env(name, ""));
  return Number.isFinite(value) ? value : fallback;
}

const DEFAULT_CALCULATOR_ITEMS = [
  { id: "awd", label: "AWD", price: 10000 },
  { id: "rwd", label: "RWD", price: 10000 },
  { id: "fwd", label: "FWD", price: 10000 },
  { id: "slick", label: "Slick", price: 6500 },
  { id: "semi", label: "Semi", price: 5500 },
  { id: "offroad", label: "Off-road", price: 5700 },
  { id: "frenos_ceramicos", label: "Frenos cerámicos", price: 20000 },
  { id: "suspension", label: "Suspensión", price: 6800 },
  { id: "cosmeticos", label: "Cosméticos", price: 4000 },
  { id: "pintura", label: "Pintura", price: 900 },
  { id: "rines", label: "Rines", price: 10000 },
  { id: "humo", label: "Humo", price: 5500 },
  { id: "extras", label: "Extras", price: 7000 },
  { id: "limpieza", label: "Limpieza", price: 600 },
  { id: "reparacion", label: "Reparación", price: 800 },
  { id: "rendimiento", label: "Rendimiento", price: 10000 },
  { id: "turbo", label: "Turbo", price: 30000 },
  { id: "v8", label: "V8", price: 50000 },
  { id: "full", label: "Full", price: 116500 }
];

function getCalculatorItems() {
  const raw = env("CALCULATOR_ITEMS_JSON", "");
  if (!raw) return DEFAULT_CALCULATOR_ITEMS;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CALCULATOR_ITEMS;

    const normalized = parsed
      .map(item => ({
        id: String(item.id || item.label || "").trim().toLowerCase().replace(/[^a-z0-9_\-]/g, "_"),
        label: String(item.label || item.id || "").trim(),
        price: Number(item.price)
      }))
      .filter(item => item.id && item.label && Number.isFinite(item.price) && item.price >= 0)
      .slice(0, 25);

    return normalized.length ? normalized : DEFAULT_CALCULATOR_ITEMS;
  } catch {
    return DEFAULT_CALCULATOR_ITEMS;
  }
}

module.exports = {
  TOKEN: env("DISCORD_TOKEN"),
  GUILD_ID: env("GUILD_ID"),
  TIMEZONE: env("TZ", env("TIMEZONE", "Europe/Madrid")),
  DATA_DIR: env("DATA_DIR", env("STOCK_DATA_DIR", env("RAILWAY_VOLUME_MOUNT_PATH", ""))),
  DATA_FILE: env("DATA_FILE"),
  ADMIN_BYPASS: envBool("ADMIN_BYPASS", true),
  WEEK_START: env("WEEK_START", "monday").toLowerCase(),
  CURRENCY_SUFFIX: env("CURRENCY_SUFFIX", "$"),

  CHANNELS: {
    FICHAJES: env("FICHAJES_CHANNEL_ID"),
    PAGOS: env("PAGOS_CHANNEL_ID"),
    CALCULADORA: env("CALCULADORA_CHANNEL_ID"),
    POSTULANTES: env("POSTULANTES_CHANNEL_ID"),
    LOGS: env("LOG_CHANNEL_ID")
  },

  ROLES: {
    ADMINS: envList("ADMIN_ROLE_IDS"),
    MANAGERS: envList("MANAGER_ROLE_IDS"),
    EMPLOYEES: envList("EMPLOYEE_ROLE_IDS"),
    PAYMENTS: envList("PAYMENT_ROLE_IDS"),
    APPLICATION_REVIEWERS: envList("APPLICATION_REVIEWER_ROLE_IDS")
  },

  CALCULATOR_ITEMS: getCalculatorItems(),
  CALCULATOR_DISCOUNTS: envList("CALCULATOR_DISCOUNTS", "0,5,10,15")
    .map(Number)
    .filter(value => Number.isFinite(value) && value >= 0 && value <= 100)
    .slice(0, 25),

  MAX_BACKUPS: envNumber("MAX_BACKUPS", 40)
};
