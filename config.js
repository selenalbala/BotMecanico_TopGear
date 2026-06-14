module.exports = {
  TOKEN: process.env.DISCORD_TOKEN || "",

  // Canal donde está el panel principal del almacén.
  CHANNEL_ID: process.env.CHANNEL_ID || "1509656133390827620",

  // Canal donde se mandan los logs sencillos.
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID || "1515320502217085018",

  // Roles que pueden cambiar el nivel de mafia.
  SET_MAFIA_LEVEL_ROLES: [
    "1509341875729993842",
    "1509343407527694407"
  ],

  // Roles superiores: pueden añadir, quitar y ver cualquier arma.
  ADD_ANY_WEAPON_ROLES: [
    "1509341875729993842",
    "1509343407527694407"
  ],

  // Roles que pueden añadir armas.
  // Estos mismos roles también pueden añadir droga.
  ADD_WEAPON_ROLES: [
    "1509341875729993842",
    "1509343407527694407",
    "1509345677753192519",
    "1509344875865178285"
  ],

  // Roles que pueden quitar/sacar armas.
  // Estos mismos roles también pueden quitar droga.
  REMOVE_WEAPON_ROLES: [
    "1509341875729993842",
    "1509343407527694407",
    "1509345677753192519"
  ],

  // Roles que pueden meter dinero.
  ADD_MONEY_ROLES: [
    "1509341875729993842",
    "1509343407527694407"
  ],

  // Roles que pueden sacar dinero.
  REMOVE_MONEY_ROLES: [
    "1509341875729993842",
    "1509343407527694407",
    "1509345677753192519",
    "1509344875865178285"
  ],

  WEAPONS: [
    "SNS",
    "9mm",
    "Vintage",
    "MK2",
    "Mini-SMG",
    "Micro-SMG",
    "TEC",
    "AK-recortada",
    "AK-47",
    "Francotirador"
  ],

  MAFIA_LEVEL_WEAPONS: {
    1: ["SNS", "9mm", "Vintage", "MK2"],
    2: ["SNS", "9mm", "Vintage", "MK2", "Mini-SMG", "Micro-SMG", "TEC"],
    3: ["SNS", "9mm", "Vintage", "MK2", "Mini-SMG", "Micro-SMG", "TEC", "AK-recortada", "AK-47", "Francotirador"]
  },

  // Drogas del almacén.
  DRUGS: [
    { id: "coca", label: "Coca" },
    { id: "heroina", label: "Heroína" },
    { id: "meta", label: "Meta" }
  ],

  // Estados posibles de cada droga.
  DRUG_STATES: [
    { id: "procesada", label: "Procesada" },
    { id: "sin_procesar", label: "Sin procesar" }
  ],

  ADMIN_BYPASS: true
};
