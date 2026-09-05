const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField,
  SlashCommandBuilder,
  MessageFlags,
  Events
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const config = require("./config");
const { iniciarWeb } = require("./web");

const calcSessions = new Map();
const employeeGuildCache = new Map();
const EMPLOYEE_CACHE_MS = 10 * 60 * 1000;


process.env.TZ = config.TIMEZONE || process.env.TZ || "Europe/Madrid";

const DATA_FILE_NAME = "autoexotic-data.json";
const PREFIX = "ae";
const MINUTE = 60 * 1000;
const MAX_DESCRIPTION = 3800;

// Tema visual Auto Exotic: azul profundo / azul eléctrico.
// Discord no permite colores personalizados en botones: Primary = azul, Danger = rojo, Secondary = gris.
const COLOR_AUTOEXOTIC_BLUE = 0x2F7DFF;
const COLOR_AUTOEXOTIC_DARK = 0x0A1633;
const COLOR_WARNING_RED = 0xC01718;


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
  if (existeDirectorio("/data")) return "/data";
  return path.join(__dirname, "data");
}

const DATA_DIR = elegirDataDir();
const DATA_FILE = config.DATA_FILE ? path.resolve(config.DATA_FILE) : path.join(DATA_DIR, DATA_FILE_NAME);
const BACKUP_DIR = path.join(path.dirname(DATA_FILE), "backups");
const LEGACY_FICHAJES_FILE = path.join(path.dirname(DATA_FILE), "fichajes.json");
const LEGACY_TOPGEAR_DATA_FILE = path.join(path.dirname(DATA_FILE), "topgear-data.json");

// Cambio de marca sin perder la base de datos que ya existía.
if (!config.DATA_FILE && !fs.existsSync(DATA_FILE) && fs.existsSync(LEGACY_TOPGEAR_DATA_FILE)) {
  try {
    fs.copyFileSync(LEGACY_TOPGEAR_DATA_FILE, DATA_FILE);
    console.log(`Base de datos anterior migrada a ${DATA_FILE_NAME}.`);
  } catch (error) {
    console.warn("No se pudo migrar la base de datos anterior:", error.message);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});

function respuestaPrivada(payload) {
  return { ...payload, flags: MessageFlags.Ephemeral };
}

function generarId(prefix = "id") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function crearDatosIniciales() {
  return {
    version: 3,
    panelMessages: {},
    openShifts: {},
    entries: [],
    employees: {},
    applications: {},
    formerMembers: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizarDatos(data) {
  const inicial = crearDatosIniciales();
  if (!data || typeof data !== "object" || Array.isArray(data)) return inicial;

  data.version = 3;
  data.panelMessages = data.panelMessages && typeof data.panelMessages === "object" ? data.panelMessages : {};
  data.openShifts = data.openShifts && typeof data.openShifts === "object" ? data.openShifts : {};
  data.entries = Array.isArray(data.entries) ? data.entries : [];
  data.employees = data.employees && typeof data.employees === "object" ? data.employees : {};
  data.applications = data.applications && typeof data.applications === "object" ? data.applications : {};
  data.formerMembers = data.formerMembers && typeof data.formerMembers === "object" ? data.formerMembers : {};
  data.migrations = data.migrations && typeof data.migrations === "object" ? data.migrations : {};
  if (!data.createdAt) data.createdAt = new Date().toISOString();
  data.updatedAt = new Date().toISOString();
  return data;
}


function parseLegacyDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const text = String(value).trim();
  if (!text) return null;

  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;

  const match = text.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const hour = Number(match[4] || 0);
    const minute = Number(match[5] || 0);
    const second = Number(match[6] || 0);
    const date = new Date(year, month - 1, day, hour, minute, second, 0);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

function firstDefined(obj, keys) {
  if (!obj || typeof obj !== "object") return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

function legacyUserId(record, fallbackUserId = null) {
  const raw = firstDefined(record, ["userId", "usuarioId", "discordId", "idDiscord", "memberId", "empleadoId", "id", "usuario"]);
  const text = raw !== undefined ? String(raw) : String(fallbackUserId || "");
  const match = text.match(/\d{17,20}/);
  return match ? match[0] : null;
}

function legacyDisplayName(record, fallbackName = null, userId = null) {
  const raw = firstDefined(record, ["displayName", "nombre", "name", "username", "usuario", "empleado", "nick", "nickname"]);
  const text = raw !== undefined ? String(raw).trim() : String(fallbackName || "").trim();
  if (text && !/^\d{17,20}$/.test(text)) return text.slice(0, 100);
  return userId ? `Usuario ${userId}` : "Usuario desconocido";
}

function legacyStart(record) {
  const value = firstDefined(record, [
    "start", "entrada", "inicio", "clockIn", "clock_in", "startedAt", "fechaEntrada", "horaEntrada", "entradaAt", "desde", "in"
  ]);
  if (value && typeof value === "object") {
    return parseLegacyDate(firstDefined(value, ["date", "fecha", "time", "hora", "at", "value", "iso"])) || parseLegacyDate(value.start);
  }
  return parseLegacyDate(value);
}

function legacyEnd(record) {
  const value = firstDefined(record, [
    "end", "salida", "fin", "clockOut", "clock_out", "endedAt", "fechaSalida", "horaSalida", "salidaAt", "hasta", "out"
  ]);
  if (value && typeof value === "object") {
    return parseLegacyDate(firstDefined(value, ["date", "fecha", "time", "hora", "at", "value", "iso"])) || parseLegacyDate(value.end);
  }
  return parseLegacyDate(value);
}

function legacyArray(value) {
  return Array.isArray(value) ? value : [];
}

function legacyChildArrays(record) {
  if (!record || typeof record !== "object") return [];
  const keys = ["fichajes", "registros", "entries", "turnos", "jornadas", "historial", "shifts", "sessions"];
  const arrays = [];
  for (const key of keys) {
    if (Array.isArray(record[key])) arrays.push(record[key]);
  }
  return arrays;
}

function recopilarLegacyRecords(raw) {
  const records = [];

  const addRecord = (record, fallback = {}) => {
    if (!record || typeof record !== "object") return;
    records.push({ record, fallback });
  };

  const walkUserObject = (userId, userObj) => {
    if (!userObj || typeof userObj !== "object") return;
    const fallbackName = legacyDisplayName(userObj, null, userId);
    const fallback = { userId, displayName: fallbackName };

    for (const arr of legacyChildArrays(userObj)) {
      for (const item of arr) addRecord(item, fallback);
    }

    if (legacyStart(userObj)) addRecord(userObj, fallback);

    const open = firstDefined(userObj, ["abierto", "fichajeAbierto", "openShift", "turnoAbierto", "entradaAbierta", "actual"]);
    if (open && typeof open === "object") addRecord(open, fallback);
  };

  if (Array.isArray(raw)) {
    for (const item of raw) addRecord(item);
    return records;
  }

  if (!raw || typeof raw !== "object") return records;

  for (const arr of legacyChildArrays(raw)) {
    for (const item of arr) addRecord(item);
  }

  for (const key of ["usuarios", "users", "empleados", "employees", "trabajadores", "members"] ) {
    const obj = raw[key];
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [userId, userObj] of Object.entries(obj)) walkUserObject(userId, userObj);
    }
  }

  // Formato antiguo del bot de fichajes:
  // { guilds: { "guildId": { "userId": [ { entrada, salida }, ... ] } } }
  if (raw.guilds && typeof raw.guilds === "object" && !Array.isArray(raw.guilds)) {
    for (const [guildId, guildObj] of Object.entries(raw.guilds)) {
      if (!guildObj || typeof guildObj !== "object" || Array.isArray(guildObj)) continue;

      for (const [userId, value] of Object.entries(guildObj)) {
        if (!/^\d{17,20}$/.test(userId)) continue;

        const fallback = { guildId, userId, displayName: `Usuario ${userId}` };

        if (Array.isArray(value)) {
          for (const item of value) addRecord(item, fallback);
        } else if (value && typeof value === "object") {
          walkUserObject(userId, value);
          if (legacyStart(value)) addRecord(value, fallback);
        }
      }
    }
  }

  // Formato común: { "123456789...": { nombre, fichajes: [...] }, ... }
  // y también { "123456789...": [ { entrada, salida }, ... ] }.
  for (const [key, value] of Object.entries(raw)) {
    if (/^\d{17,20}$/.test(key)) {
      if (Array.isArray(value)) {
        for (const item of value) addRecord(item, { userId: key, displayName: `Usuario ${key}` });
      } else if (value && typeof value === "object") {
        walkUserObject(key, value);
      }
    }
  }

  return records;
}

function firmaEntry(entry) {
  return `${entry.type || "shift"}|${entry.userId || ""}|${entry.start || entry.date || ""}|${entry.end || "open"}|${entry.minutes || ""}`;
}

function importarFichajesLegacySiExiste(data) {
  try {
    if (!fs.existsSync(LEGACY_FICHAJES_FILE)) return data;

    const stat = fs.statSync(LEGACY_FICHAJES_FILE);
    const migrationKey = `fichajes.json.v2:${stat.mtimeMs}:${stat.size}`;
    if (data.migrations?.legacyFichajesJsonV2Key === migrationKey) return data;

    const contenido = fs.readFileSync(LEGACY_FICHAJES_FILE, "utf8").trim();
    if (!contenido) return data;

    const raw = JSON.parse(contenido);
    const records = recopilarLegacyRecords(raw);
    const existentes = new Set((data.entries || []).map(firmaEntry));
    const openExistentes = new Set(Object.keys(data.openShifts || {}));
    let importados = 0;
    let abiertos = 0;
    let ignorados = 0;

    for (const { record, fallback } of records) {
      const userId = legacyUserId(record, fallback.userId);
      if (!userId) { ignorados += 1; continue; }

      const displayName = legacyDisplayName(record, fallback.displayName, userId);
      const start = legacyStart(record);
      const end = legacyEnd(record);
      if (!start) { ignorados += 1; continue; }

      touchEmpleado(data, userId, displayName);

      if (end && end.getTime() >= start.getTime()) {
        const entry = {
          id: generarId("legacy"),
          type: "shift",
          userId,
          displayName,
          start: start.toISOString(),
          end: end.toISOString(),
          createdAt: new Date().toISOString(),
          importedFrom: "fichajes.json"
        };
        const firma = firmaEntry(entry);
        if (!existentes.has(firma)) {
          data.entries.push(entry);
          existentes.add(firma);
          importados += 1;
        }
      } else if (!openExistentes.has(userId)) {
        data.openShifts[userId] = {
          userId,
          displayName,
          start: start.toISOString(),
          importedFrom: "fichajes.json"
        };
        openExistentes.add(userId);
        abiertos += 1;
      }
    }

    data.migrations.legacyFichajesJsonV2Key = migrationKey;
    data.migrations.legacyFichajesJsonKey = migrationKey;
    data.migrations.legacyFichajesJsonImportedAt = new Date().toISOString();
    data.migrations.legacyFichajesJsonImportedEntries = importados;
    data.migrations.legacyFichajesJsonImportedOpenShifts = abiertos;
    data.migrations.legacyFichajesJsonIgnored = ignorados;

    if (importados || abiertos) {
      console.log(`Importado fichajes.json: ${importados} fichajes cerrados, ${abiertos} fichajes abiertos, ${ignorados} ignorados.`);
      guardarDatos(data);
    } else {
      console.warn(`Se encontró fichajes.json, pero no se pudo importar ningún fichaje. Registros leídos: ${records.length}, ignorados: ${ignorados}.`);
      guardarDatos(data);
    }
  } catch (error) {
    console.error("No se pudo importar /app/data/fichajes.json:", error.message);
  }
  return data;
}

function cargarDatos() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const data = importarFichajesLegacySiExiste(crearDatosIniciales());
      guardarDatos(data, { backup: false });
      return data;
    }

    const contenido = fs.readFileSync(DATA_FILE, "utf8").trim();
    if (!contenido) return crearDatosIniciales();
    return importarFichajesLegacySiExiste(normalizarDatos(JSON.parse(contenido)));
  } catch (error) {
    console.error("No se pudo leer el archivo de datos. Se creará uno nuevo:", error.message);
    return crearDatosIniciales();
  }
}

function limpiarBackupsAntiguos() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(name => /^(autoexotic|topgear)-/.test(name) && name.endsWith(".json"))
      .map(name => {
        const filePath = path.join(BACKUP_DIR, name);
        return { name, filePath, time: fs.statSync(filePath).mtimeMs };
      })
      .sort((a, b) => b.time - a.time);

    for (const backup of backups.slice(config.MAX_BACKUPS || 40)) {
      fs.unlinkSync(backup.filePath);
    }
  } catch (error) {
    console.warn("No se pudieron limpiar backups antiguos:", error.message);
  }
}

function crearBackupSiExiste() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const sello = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `autoexotic-${sello}.json`));
    limpiarBackupsAntiguos();
  } catch (error) {
    console.warn("No se pudo crear backup:", error.message);
  }
}

function guardarDatos(data, options = {}) {
  const { backup = true } = options;
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const normalizado = normalizarDatos(data);
  if (backup) crearBackupSiExiste();
  const temporal = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(normalizado, null, 2), "utf8");
  fs.renameSync(temporal, DATA_FILE);
}

function logDatos() {
  console.log(`Datos guardándose en: ${DATA_FILE}`);
  if (!config.DATA_FILE && !config.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !existeDirectorio("/data")) {
    console.warn("AVISO: no se ha detectado volumen persistente. En Railway monta un Volume en /data o define DATA_DIR=/data.");
  }
}

function logConfiguracionPaneles() {
  console.log("Configuración de canales cargada:");
  console.log(`- FICHAJES_CHANNEL_ID / CHANNEL_ID: ${config.CHANNELS.FICHAJES || "NO CONFIGURADO"}`);
  console.log(`- PAGOS_CHANNEL_ID: ${config.CHANNELS.PAGOS || "NO CONFIGURADO"}`);
  console.log(`- CALCULADORA_CHANNEL_ID: ${config.CHANNELS.CALCULADORA || "NO CONFIGURADO"}`);
  console.log(`- POSTULANTES_CHANNEL_ID: ${config.CHANNELS.POSTULANTES || "NO CONFIGURADO"}`);
  console.log(`- LOG_CHANNEL_ID: ${config.CHANNELS.LOGS || "NO CONFIGURADO"}`);
  console.log(`- WEB_ORDERS_CHANNEL_ID: ${config.CHANNELS.WEB_ORDERS || "NO CONFIGURADO"}`);
}

async function comprobarPermisosCanal(channel, key) {
  try {
    const guild = channel.guild;
    if (!guild) return true;
    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    if (!me) {
      console.warn(`No se pudo comprobar permisos para el panel ${key}. Intentaré publicar igualmente.`);
      return true;
    }

    const permisos = channel.permissionsFor(me);
    const faltan = [];
    if (!permisos?.has(PermissionsBitField.Flags.ViewChannel)) faltan.push("Ver canal");
    if (!permisos?.has(PermissionsBitField.Flags.SendMessages)) faltan.push("Enviar mensajes");
    if (!permisos?.has(PermissionsBitField.Flags.EmbedLinks)) faltan.push("Insertar enlaces / Embed Links");
    if (!permisos?.has(PermissionsBitField.Flags.ReadMessageHistory)) faltan.push("Leer historial de mensajes");

    if (faltan.length) {
      console.error(`No puedo publicar el panel ${key} en #${channel.name || channel.id}. Faltan permisos: ${faltan.join(", ")}.`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`No se pudieron comprobar permisos del panel ${key}:`, error.message);
    return true;
  }
}

function tieneRol(interaction, roleIds) {
  const ids = Array.isArray(roleIds) ? roleIds.filter(Boolean) : [];
  if (config.ADMIN_BYPASS && interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator)) return true;
  if (!interaction.member?.roles?.cache) return false;
  return ids.some(roleId => interaction.member.roles.cache.has(roleId));
}

function tieneCualquierRol(interaction, grupos) {
  return grupos.some(grupo => tieneRol(interaction, grupo));
}

function esAdminOEncargado(interaction) {
  return tieneCualquierRol(interaction, [config.ROLES.ADMINS, config.ROLES.MANAGERS]);
}

function puedeFichar(interaction) {
  if (!config.ROLES.EMPLOYEES.length) return true;
  return tieneCualquierRol(interaction, [config.ROLES.EMPLOYEES, config.ROLES.MANAGERS, config.ROLES.ADMINS]);
}

function puedeGestionarPagos(interaction) {
  return tieneCualquierRol(interaction, [config.ROLES.PAYMENTS, config.ROLES.MANAGERS, config.ROLES.ADMINS]);
}

function rolesRevisoresPostulaciones() {
  const ids = [
    ...(config.ROLES.APPLICATION_REVIEWERS || []),
    ...(config.ROLES.PAYMENTS || []),
    ...(config.ROLES.MANAGERS || []),
    ...(config.ROLES.ADMINS || [])
  ];
  return [...new Set(ids.filter(Boolean))];
}

function rolesAceptarPostulacion() {
  const configurados = config.ROLES.APPLICATION_ACCEPT || [];
  if (configurados.length) return configurados.filter(Boolean);
  // Fallback para que no se quede sin rol si no configuras APPLICATION_ACCEPT_ROLE_IDS.
  return (config.ROLES.EMPLOYEES || []).slice(0, 1).filter(Boolean);
}

function puedeRevisarPostulaciones(interaction) {
  return tieneCualquierRol(interaction, [
    config.ROLES.APPLICATION_REVIEWERS,
    config.ROLES.PAYMENTS,
    config.ROLES.MANAGERS,
    config.ROLES.ADMINS
  ]);
}

function limpiarNombreCanal(texto) {
  return String(texto || "postulacion")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "postulacion";
}

function nombreMiembro(interaction) {
  return interaction.member?.displayName || interaction.user?.globalName || interaction.user?.username || `Usuario ${interaction.user?.id || "desconocido"}`;
}

function touchEmpleado(data, userId, displayName, extra = {}) {
  if (!userId) return;
  const anterior = data.employees[userId] || {};
  data.employees[userId] = {
    userId,
    displayName: displayName || anterior.displayName || `Usuario ${userId}`,
    avatarURL: extra.avatarURL || anterior.avatarURL || null,
    roleIds: Array.isArray(extra.roleIds) ? extra.roleIds : (anterior.roleIds || []),
    roleNames: Array.isArray(extra.roleNames) ? extra.roleNames : (anterior.roleNames || []),
    firstSeenAt: anterior.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };
}

function avatarUsuario(userOrMember) {
  try {
    if (userOrMember?.displayAvatarURL) return userOrMember.displayAvatarURL({ size: 128 });
    if (userOrMember?.user?.displayAvatarURL) return userOrMember.user.displayAvatarURL({ size: 128 });
  } catch {}
  return null;
}

function nombreDesdeMember(member) {
  return member?.displayName || member?.user?.globalName || member?.user?.username || `Usuario ${member?.id || "desconocido"}`;
}

function rolesEmpleadosConfigurados() {
  const ids = [
    ...(config.ROLES.TRACKED_EMPLOYEES || []),
    ...(config.ROLES.EMPLOYEES || []),
    ...(config.ROLES.MANAGERS || []),
    ...(config.ROLES.ADMINS || []),
    ...(config.ROLES.PAYMENTS || [])
  ];
  return [...new Set(ids.filter(Boolean))];
}

function memberTieneRolEmpleado(member) {
  const roleIds = rolesEmpleadosConfigurados();
  if (!roleIds.length) return false;
  return roleIds.some(roleId => member?.roles?.cache?.has(roleId));
}

function rolesAplicablesPostulante() {
  return [...new Set([...(config.ROLES.JOIN || []), ...(config.ROLES.APPLICANT || [])].filter(Boolean))];
}

async function obtenerMiembroSeguro(guild, userId) {
  if (!guild || !userId) return null;
  return guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
}

function cerrarFichajeAbierto(data, userId, opciones = {}) {
  const abierta = data.openShifts?.[userId];
  if (!abierta?.start) return null;

  const inicio = new Date(abierta.start);
  let fin = opciones.endAt instanceof Date ? opciones.endAt : new Date(opciones.endAt || Date.now());
  if (Number.isNaN(inicio.getTime())) {
    delete data.openShifts[userId];
    return null;
  }
  if (Number.isNaN(fin.getTime())) fin = new Date();
  if (fin < inicio) fin = new Date(inicio.getTime());

  const displayName = opciones.displayName || abierta.displayName || data.employees?.[userId]?.displayName || `Usuario ${userId}`;
  const entry = {
    id: generarId("shift"),
    type: "shift",
    userId,
    displayName,
    start: inicio.toISOString(),
    end: fin.toISOString(),
    createdAt: new Date().toISOString(),
    closedAutomatically: Boolean(opciones.automatic),
    closeReason: String(opciones.reason || "Cierre de fichaje").slice(0, 120)
  };

  if (opciones.closedBy) entry.closedBy = opciones.closedBy;
  if (opciones.closedByName) entry.closedByName = opciones.closedByName;

  data.entries.push(entry);
  delete data.openShifts[userId];
  return {
    entry,
    inicio,
    fin,
    minutos: Math.max(0, Math.round((fin.getTime() - inicio.getTime()) / MINUTE))
  };
}

function retirarEmpleadoActivo(data, userId, opciones = {}) {
  const displayName = opciones.displayName || data.employees?.[userId]?.displayName || `Usuario ${userId}`;
  const cierre = cerrarFichajeAbierto(data, userId, {
    endAt: opciones.endAt || new Date(),
    displayName,
    reason: opciones.reason || "Empleado retirado del censo activo",
    automatic: opciones.automatic !== false,
    closedBy: opciones.closedBy,
    closedByName: opciones.closedByName
  });

  delete data.employees[userId];
  // No mantenemos un segundo censo de exempleados: evita que vuelvan a aparecer por datos antiguos.
  if (data.formerMembers) delete data.formerMembers[userId];
  return cierre;
}

async function sincronizarCensoEmpleadosGuild(guild, data = cargarDatos()) {
  const roleIds = rolesEmpleadosConfigurados();
  if (!guild || !roleIds.length) return { ok: false, activos: [], retirados: 0, cerrados: 0 };

  try {
    // Esta carga completa es deliberada: solo limpiamos la BBDD cuando Discord ha confirmado la lista completa.
    await guild.members.fetch();
  } catch (error) {
    console.warn("No se sincroniza el censo de empleados porque no se pudo cargar la lista completa del servidor:", error.message);
    return { ok: false, activos: [], retirados: 0, cerrados: 0 };
  }

  const activos = [];
  const activeIds = new Set();
  for (const member of guild.members.cache.values()) {
    if (member.user?.bot || !memberTieneRolEmpleado(member)) continue;
    const memberRoleIds = roleIds.filter(roleId => member.roles.cache.has(roleId));
    const roleNames = memberRoleIds
      .map(roleId => member.guild.roles.cache.get(roleId)?.name || "Rol")
      .filter(Boolean);
    const displayName = nombreDesdeMember(member);
    const avatarURL = avatarUsuario(member);
    touchEmpleado(data, member.id, displayName, { avatarURL, roleIds: memberRoleIds, roleNames });
    activeIds.add(member.id);
    activos.push({ userId: member.id, displayName, avatarURL, roleNames });
  }

  let retirados = 0;
  let cerrados = 0;
  const candidatos = new Set([
    ...Object.keys(data.employees || {}),
    ...Object.keys(data.openShifts || {})
  ]);

  for (const userId of candidatos) {
    if (activeIds.has(userId)) continue;
    const displayName = data.employees?.[userId]?.displayName || data.openShifts?.[userId]?.displayName || `Usuario ${userId}`;
    const cierre = retirarEmpleadoActivo(data, userId, {
      displayName,
      reason: "Ya no está en el servidor o ya no tiene un rol de empleado",
      automatic: true
    });
    if (cierre) cerrados += 1;
    retirados += 1;
  }

  guardarDatos(data);
  const lista = activos.sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
  employeeGuildCache.set(guild.id, { createdAt: Date.now(), empleados: lista });
  return { ok: true, activos: lista, retirados, cerrados };
}

async function obtenerEmpleadosGuild(interactionOrGuild, data = cargarDatos(), opciones = {}) {
  const guild = interactionOrGuild?.guild || interactionOrGuild;
  const roleIds = rolesEmpleadosConfigurados();
  const cacheKey = guild?.id || "sin-guild";
  const cached = employeeGuildCache.get(cacheKey);
  const now = Date.now();

  if (!guild) return [];

  if (!roleIds.length) {
    // Sin roles configurados no podemos distinguir de forma segura quién es empleado.
    return Object.values(data.employees || {})
      .map(emp => ({
        userId: emp.userId,
        displayName: emp.displayName || "Usuario desconocido",
        avatarURL: emp.avatarURL || null,
        roleNames: emp.roleNames || []
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
  }

  if (!opciones.force && cached && now - cached.createdAt < EMPLOYEE_CACHE_MS) {
    return cached.empleados.slice();
  }

  const sync = await sincronizarCensoEmpleadosGuild(guild, data);
  if (sync.ok) return sync.activos;

  // Si Discord falla temporalmente, solo reutilizamos una lista que ya fue validada anteriormente.
  if (cached?.empleados?.length) return cached.empleados.slice();

  // Último fallback seguro: miembros que Discord ya tiene cacheados y que conservan el rol.
  const empleados = [];
  for (const member of guild.members.cache.values()) {
    if (member.user?.bot || !memberTieneRolEmpleado(member)) continue;
    const memberRoleIds = roleIds.filter(roleId => member.roles.cache.has(roleId));
    const roleNames = memberRoleIds.map(roleId => member.guild.roles.cache.get(roleId)?.name || "Rol").filter(Boolean);
    empleados.push({ userId: member.id, displayName: nombreDesdeMember(member), avatarURL: avatarUsuario(member), roleNames });
  }
  return empleados.sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatTime(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDateTime(date) {
  return `${formatDate(date)} ${formatTime(date)}`;
}

function parseDateOnly(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return copy;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function startOfWeek(date = new Date()) {
  const base = startOfDay(date);
  const day = base.getDay();
  const mondayDiff = day === 0 ? -6 : 1 - day;
  const sundayDiff = -day;
  return addDays(base, config.WEEK_START === "sunday" ? sundayDiff : mondayDiff);
}

function rangoEstaSemana() {
  const start = startOfWeek(new Date());
  return { start, endExclusive: addDays(start, 7), label: "esta semana" };
}

function rangoSemanaPasada() {
  const thisStart = startOfWeek(new Date());
  const start = addDays(thisStart, -7);
  return { start, endExclusive: thisStart, label: "semana pasada" };
}

function rangoHoy() {
  const start = startOfDay(new Date());
  return { start, endExclusive: addDays(start, 1), label: "hoy" };
}

function parseDateTimeLocal(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "ahora" || text === "now") return new Date();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), 0, 0);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date;
}

function rangoDesdeHasta(desdeTexto, hastaTexto) {
  const start = parseDateOnly(desdeTexto);
  const endInclusive = parseDateOnly(hastaTexto);
  if (!start || !endInclusive) return null;
  if (endInclusive < start) return null;
  return {
    start,
    endExclusive: addDays(endInclusive, 1),
    label: `${formatDate(start)} a ${formatDate(endInclusive)}`
  };
}

function endInclusive(range) {
  return addDays(range.endExclusive, -1);
}

function etiquetaRango(range) {
  return `${formatDate(range.start)} → ${formatDate(endInclusive(range))}`;
}

function parseHoras(text) {
  const raw = String(text || "").trim().toLowerCase().replace(/horas?/g, "").trim();
  if (!raw) return null;

  const hm = raw.match(/^(-?\d+)\s*[:h]\s*(\d{1,2})$/);
  if (hm) {
    const sign = Number(hm[1]) < 0 ? -1 : 1;
    const horas = Math.abs(Number(hm[1]));
    const minutos = Number(hm[2]);
    if (!Number.isFinite(horas) || !Number.isFinite(minutos) || minutos > 59) return null;
    return sign * (horas * 60 + minutos);
  }

  const normalized = raw.replace(",", ".");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 60);
}

function minutosAHoras(minutos) {
  const sign = minutos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutos));
  const horas = Math.floor(abs / 60);
  const mins = abs % 60;
  return `${sign}${horas}h ${pad2(mins)}m`;
}

function formatearDinero(value) {
  return `${new Intl.NumberFormat("es-ES").format(value)}${config.CURRENCY_SUFFIX}`;
}

function limitarTexto(texto, max = MAX_DESCRIPTION) {
  const string = String(texto || "");
  return string.length > max ? `${string.slice(0, max - 30)}\n…resultado recortado.` : string;
}

function normalizarBusqueda(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extraerUserId(texto) {
  const match = String(texto || "").match(/\d{17,20}/);
  return match ? match[0] : null;
}

async function resolverEmpleado(interaction, texto, data = cargarDatos()) {
  const entrada = String(texto || "").trim();
  if (!entrada) return { error: "Debes indicar una mención, ID o nombre del empleado." };

  const id = extraerUserId(entrada);
  if (id) {
    const member = await obtenerMiembroSeguro(interaction.guild, id);
    if (rolesEmpleadosConfigurados().length && (!member || !memberTieneRolEmpleado(member))) {
      return { error: "Ese usuario no es un empleado activo: no está en el servidor o ya no tiene un rol de empleado." };
    }
    const displayName = member ? nombreDesdeMember(member) : (data.employees[id]?.displayName || "Usuario desconocido");
    const memberRoleIds = member ? rolesEmpleadosConfigurados().filter(roleId => member.roles.cache.has(roleId)) : [];
    const roleNames = memberRoleIds.map(roleId => member.guild.roles.cache.get(roleId)?.name || "Rol").filter(Boolean);
    touchEmpleado(data, id, displayName, { avatarURL: avatarUsuario(member), roleIds: memberRoleIds, roleNames });
    return { userId: id, displayName };
  }

  const query = normalizarBusqueda(entrada);
  const coincidencias = Object.values(data.employees || {})
    .filter(emp => normalizarBusqueda(emp.displayName).includes(query))
    .slice(0, 10);

  if (coincidencias.length === 1) {
    return { userId: coincidencias[0].userId, displayName: coincidencias[0].displayName };
  }

  if (coincidencias.length > 1) {
    return {
      error: `Hay varios empleados con ese nombre. Usa la mención o ID.\n${coincidencias.map(emp => `• ${emp.displayName} — ${emp.userId}`).join("\n")}`
    };
  }

  return { error: "No encontré ese empleado. Usa su mención o su ID de Discord." };
}

function calcularMinutosEmpleado(data, userId, range) {
  const startMs = range.start.getTime();
  const endMs = range.endExclusive.getTime();
  let minutos = 0;
  let minutosAjuste = 0;
  let fichajes = 0;
  let abiertos = 0;
  const lineas = [];

  for (const entry of data.entries || []) {
    if (entry.userId !== userId) continue;

    if (entry.type === "adjustment") {
      const fecha = parseDateOnly(entry.date);
      if (!fecha) continue;
      const fechaMs = fecha.getTime();
      if (fechaMs >= startMs && fechaMs < endMs) {
        const value = Number(entry.minutes || 0);
        minutos += value;
        minutosAjuste += value;
        lineas.push(`🛠️ ${entry.date} — ajuste ${minutosAHoras(value)}${entry.note ? ` · ${entry.note}` : ""}`);
      }
      continue;
    }

    const inicio = new Date(entry.start);
    const fin = entry.end ? new Date(entry.end) : new Date();
    const iniMs = Math.max(inicio.getTime(), startMs);
    const finMs = Math.min(fin.getTime(), endMs);
    if (finMs > iniMs) {
      const minutosEntrada = Math.round((finMs - iniMs) / MINUTE);
      minutos += minutosEntrada;
      fichajes += 1;
      lineas.push(`• ${formatDate(inicio)} ${formatTime(inicio)} → ${entry.end ? formatTime(fin) : "abierto"} · ${minutosAHoras(minutosEntrada)}`);
      if (!entry.end) abiertos += 1;
    }
  }

  const open = data.openShifts?.[userId];
  if (open?.start) {
    const inicio = new Date(open.start);
    const fin = new Date();
    const iniMs = Math.max(inicio.getTime(), startMs);
    const finMs = Math.min(fin.getTime(), endMs);
    if (finMs > iniMs) {
      const minutosEntrada = Math.round((finMs - iniMs) / MINUTE);
      minutos += minutosEntrada;
      abiertos += 1;
      lineas.push(`${formatDate(inicio)} ${formatTime(inicio)} → ahora · ${minutosAHoras(minutosEntrada)}`);
    }
  }

  return { minutos, minutosAjuste, fichajes, abiertos, lineas };
}

function obtenerIdsEmpleados(data) {
  const ids = new Set(Object.keys(data.employees || {}));
  for (const entry of data.entries || []) {
    if (entry.userId) ids.add(entry.userId);
  }
  for (const userId of Object.keys(data.openShifts || {})) {
    ids.add(userId);
  }
  return [...ids];
}

function embedEmpleado(data, userId, range, title = "Consulta de empleado") {
  const empleado = data.employees?.[userId];
  const displayName = empleado?.displayName || "Usuario desconocido";
  const total = calcularMinutosEmpleado(data, userId, range);
  const detalle = total.lineas.length
    ? total.lineas.slice(-18).join("\n")
    : "No hay fichajes en este periodo.";

  const embed = new EmbedBuilder()
    .setColor(COLOR_AUTOEXOTIC_BLUE)
    .setTitle(title)
    .setDescription(`**Empleado:** ${displayName}\n**Periodo:** ${etiquetaRango(range)}\n**Total:** ${minutosAHoras(total.minutos)}${total.abiertos ? "\nTiene un fichaje abierto." : ""}`)
    .addFields(
      { name: "Fichajes", value: String(total.fichajes), inline: true },
      { name: "Ajustes", value: minutosAHoras(total.minutosAjuste), inline: true },
      { name: "Detalle", value: limitarTexto(detalle, 1000), inline: false }
    )
    .setTimestamp();

  if (empleado?.avatarURL) embed.setThumbnail(empleado.avatarURL);
  return embed;
}

function embedTodos(data, range, title = "Consulta de empleados") {
  const ids = obtenerIdsEmpleados(data);
  const resultados = ids.map(userId => {
    const total = calcularMinutosEmpleado(data, userId, range);
    const displayName = data.employees?.[userId]?.displayName || `Usuario ${userId}`;
    return { userId, displayName, ...total };
  })
    .filter(item => item.minutos !== 0 || item.fichajes > 0 || item.abiertos > 0)
    .sort((a, b) => b.minutos - a.minutos || a.displayName.localeCompare(b.displayName));

  const descripcion = resultados.length
    ? resultados.map(item => {
      const aviso = item.abiertos ? "" : "";
      const ajuste = item.minutosAjuste ? ` · ajustes ${minutosAHoras(item.minutosAjuste)}` : "";
      return `• **${item.displayName}** — ${minutosAHoras(item.minutos)}${ajuste}${aviso}`;
    }).join("\n")
    : "No hay fichajes en este periodo.";

  const totalGeneral = resultados.reduce((acc, item) => acc + item.minutos, 0);

  return new EmbedBuilder()
    .setColor(COLOR_AUTOEXOTIC_BLUE)
    .setTitle(title)
    .setDescription(limitarTexto(descripcion))
    .addFields(
      { name: "Periodo", value: etiquetaRango(range), inline: true },
      { name: "Empleados", value: String(resultados.length), inline: true },
      { name: "Total general", value: minutosAHoras(totalGeneral), inline: true }
    )
    .setTimestamp();
}

function embedTodosDesdeLista(data, empleados, range, title = "Consulta de empleados") {
  const lista = Array.isArray(empleados) ? empleados : [];
  const resultados = lista.map(emp => {
    const userId = emp.userId;
    const total = calcularMinutosEmpleado(data, userId, range);
    const displayName = emp.displayName || data.employees?.[userId]?.displayName || "Usuario desconocido";
    return { userId, displayName, roleNames: emp.roleNames || [], ...total };
  })
    // Aquí NO filtramos por horas: en pagos deben aparecer todos los empleados con rol, aunque estén a 0.
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));

  const descripcion = resultados.length
    ? resultados.map(item => {
      const ajuste = item.minutosAjuste ? ` · ajustes ${minutosAHoras(item.minutosAjuste)}` : "";
      const abierto = item.abiertos ? " · fichaje abierto" : "";
      return `• **${item.displayName}** — ${minutosAHoras(item.minutos)}${ajuste}${abierto}`;
    }).join("\n")
    : "No hay empleados cargados. Revisa TRACKED_EMPLOYEE_ROLE_IDS y Server Members Intent.";

  const totalGeneral = resultados.reduce((acc, item) => acc + item.minutos, 0);

  return new EmbedBuilder()
    .setColor(COLOR_AUTOEXOTIC_BLUE)
    .setTitle(title)
    .setDescription(limitarTexto(descripcion))
    .addFields(
      { name: "Periodo", value: etiquetaRango(range), inline: true },
      { name: "Empleados", value: String(resultados.length), inline: true },
      { name: "Total general", value: minutosAHoras(totalGeneral), inline: true }
    )
    .setTimestamp();
}

async function enviarLog(texto) {
  const logChannelId = config.CHANNELS.LOGS;
  if (!logChannelId) {
    console.warn("LOG_CHANNEL_ID no configurado.", texto);
    return false;
  }

  try {
    const channel = await client.channels.fetch(logChannelId);
    if (!channel?.isTextBased()) return false;
    await channel.send(limitarTexto(texto, 1900));
    return true;
  } catch (error) {
    console.error(`No se pudo enviar log al canal ${logChannelId}:`, error.message);
    return false;
  }
}

async function responderError(interaction, texto) {
  const payload = respuestaPrivada({ content: `❌ ${texto}` });
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

async function responderOk(interaction, texto, extra = {}) {
  const payload = respuestaPrivada({ content: `✅ ${texto}`, ...extra });
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload).catch(() => {});
  return interaction.reply(payload).catch(() => {});
}

async function sinPermiso(interaction) {
  return responderError(interaction, "No tienes permisos para usar esta opción.");
}

function crearEmbedFichajes() {
  return new EmbedBuilder()
    .setColor(COLOR_AUTOEXOTIC_BLUE)
    .setTitle("🕒 Fichajes Auto Exotic")
    .setDescription("Ficha tu entrada y salida. También puedes consultar tus horas por semana.")
    .setFooter({ text: "Auto Exotic · Control de horas" })
    .setTimestamp();
}

function crearBotonesFichajes() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:entrada`).setLabel("Entrada").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:salida`).setLabel("Salida").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:mishoras`).setLabel("⏱️ Mis horas").setStyle(ButtonStyle.Primary)
    )
  ];
}

function crearOpcionesMisHoras() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:mishoras:esta`).setLabel("Esta semana").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:mishoras:pasada`).setLabel("Semana pasada").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:mishoras:rango`).setLabel("Elegir fechas").setStyle(ButtonStyle.Secondary)
    )
  ];
}

function crearEmbedPagos() {
  return new EmbedBuilder()
    .setColor(COLOR_AUTOEXOTIC_BLUE)
    .setTitle("Auto Exotic | Pagos")
    .setDescription("Panel para consultar y gestionar las horas del equipo.\n\nAl elegir un empleado puedes ajustar **hoy**, **esta semana** o un **rango personalizado**, y también cerrar un fichaje que se haya quedado abierto.")
    .setTimestamp();
}

function crearBotonesPagos() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:consultar`).setLabel("Consultar empleado").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:modificar`).setLabel("🛠️ Modificar horas").setStyle(ButtonStyle.Danger)
    )
  ];
}

function empleadosParaSelector(data) {
  return obtenerIdsEmpleados(data)
    .map(userId => ({
      userId,
      displayName: data.employees?.[userId]?.displayName || "Usuario desconocido",
      avatarURL: data.employees?.[userId]?.avatarURL || null,
      roleNames: data.employees?.[userId]?.roleNames || []
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
}

function crearSelectoresEmpleadosDesdeLista(empleados, modo, placeholderBase) {
  const lista = empleados.slice(0, 100);
  const rows = [];
  for (let i = 0; i < lista.length; i += 25) {
    const chunk = lista.slice(i, i + 25);
    const parte = Math.floor(i / 25) + 1;
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}:pagos:selectempleado:${modo}:${parte}`)
          .setPlaceholder(lista.length > 25 ? `${placeholderBase} · parte ${parte}` : placeholderBase)
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(chunk.map(emp => ({
            label: emp.displayName.slice(0, 100),
            value: emp.userId,
            description: (emp.roleNames?.length ? emp.roleNames.join(", ") : "Empleado Auto Exotic").slice(0, 100)
          })))
      )
    );
  }
  return rows;
}

function crearSelectoresEmpleados(data, modo, placeholderBase) {
  return crearSelectoresEmpleadosDesdeLista(empleadosParaSelector(data), modo, placeholderBase);
}

async function crearOpcionesConsultaPagos(interaction, data) {
  const empleados = await obtenerEmpleadosGuild(interaction, data);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:todos:esta`).setLabel("Todos · esta semana").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:todos:pasada`).setLabel("Todos · semana pasada").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:todos:rango`).setLabel("Todos · rango").setStyle(ButtonStyle.Secondary)
    )
  ];

  rows.push(...crearSelectoresEmpleadosDesdeLista(empleados, "consultar", "Selecciona empleado"));
  return { rows: rows.slice(0, 5), empleados };
}

async function crearSelectorModificarHoras(interaction, data) {
  const empleados = await obtenerEmpleadosGuild(interaction, data);
  return {
    rows: crearSelectoresEmpleadosDesdeLista(empleados, "modificar", "Selecciona empleado para modificar horas").slice(0, 5),
    empleados
  };
}

function crearOpcionesRangoEmpleado(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:emp:${userId}:esta`).setLabel("Esta semana").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:emp:${userId}:pasada`).setLabel("Semana pasada").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:emp:${userId}:rango`).setLabel("Elegir fechas").setStyle(ButtonStyle.Secondary)
    )
  ];
}

function crearEmbedCalculadora() {
  return new EmbedBuilder()
    .setColor(COLOR_AUTOEXOTIC_BLUE)
    .setTitle("Auto Exotic | Calculadora")
    .setDescription("Abre la calculadora para calcular mejoras, reparaciones y descuentos.")
    .setTimestamp();
}

function crearBotonesCalculadora() {
  const botones = [];

  if (config.WEB_URL) {
    botones.push(
      new ButtonBuilder()
        .setLabel("🌐 Abrir calculadora web")
        .setStyle(ButtonStyle.Link)
        .setURL(config.WEB_URL)
    );
  }

  botones.push(
    // Discord a veces rechaza algunos unicode en setEmoji().
    // Por eso el emote va dentro del texto del botón.
    new ButtonBuilder()
      .setCustomId(`${PREFIX}:calc:abrir`)
      .setLabel("🧮 Calculadora Discord")
      .setStyle(ButtonStyle.Primary)
  );

  return [
    new ActionRowBuilder().addComponents(botones)
  ];
}

function crearEmbedPostulantes() {
  return new EmbedBuilder()
    .setColor(COLOR_AUTOEXOTIC_BLUE)
    .setTitle("🏁 Postulaciones Auto Exotic")
    .setDescription(`¿Quieres unirte al taller?\n\nPulsa el botón de abajo y completa tu solicitud.\n\n🔧 La postulación será revisada por el equipo encargado.`)
    .setFooter({ text: "Auto Exotic · Sistema de postulaciones" })
    .setTimestamp();
}

function crearBotonesPostulantes() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:postular:abrir`).setLabel("Crear postulación").setStyle(ButtonStyle.Primary)
    )
  ];
}

function panelPayload(key) {
  if (key === "fichajes") return { embeds: [crearEmbedFichajes()], components: crearBotonesFichajes() };
  if (key === "pagos") return { embeds: [crearEmbedPagos()], components: crearBotonesPagos() };
  if (key === "calculadora") return { content: "", embeds: [], components: crearBotonesCalculadora() };
  if (key === "postulantes") return { embeds: [crearEmbedPostulantes()], components: crearBotonesPostulantes() };
  return null;
}

function idsPanel(key) {
  if (key === "fichajes") return [`${PREFIX}:ficha:entrada`, `${PREFIX}:ficha:salida`, `${PREFIX}:ficha:mishoras`];
  if (key === "pagos") return [`${PREFIX}:pagos:consultar`, `${PREFIX}:pagos:modificar`];
  if (key === "calculadora") return [`${PREFIX}:calc:abrir`];
  if (key === "postulantes") return [`${PREFIX}:postular:abrir`];
  return [];
}

function esMensajePanel(key, message) {
  if (!message || message.author?.id !== client.user?.id) return false;
  const ids = idsPanel(key);
  return Boolean(message.components?.some(row => row.components?.some(component => ids.includes(component.customId))));
}

async function publicarPanel(key, channelId) {
  if (!channelId) return false;
  const payload = panelPayload(key);
  if (!payload) return false;

  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (error) {
    console.error(`No se pudo encontrar el canal ${channelId} para el panel ${key}:`, error.message);
    return false;
  }

  if (!channel?.isTextBased()) {
    console.error(`El canal ${channelId} no es de texto para el panel ${key}. Usa un canal de texto normal.`);
    return false;
  }

  if (!(await comprobarPermisosCanal(channel, key))) return false;

  const data = cargarDatos();
  const guardado = data.panelMessages?.[key];
  let mensaje = null;

  if (guardado) {
    mensaje = await channel.messages.fetch(guardado).catch(() => null);
  }

  if (!mensaje) {
    const recientes = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    mensaje = recientes?.filter(msg => esMensajePanel(key, msg)).first() || null;
  }

  try {
    if (mensaje) {
      await mensaje.edit(payload);
      data.panelMessages[key] = mensaje.id;
      guardarDatos(data);
      console.log(`Panel ${key} actualizado en ${channelId}.`);
    } else {
      mensaje = await channel.send(payload);
      data.panelMessages[key] = mensaje.id;
      guardarDatos(data);
      console.log(`Panel ${key} creado en ${channelId}.`);
    }

    const recientes = await channel.messages.fetch({ limit: 25 }).catch(() => null);
    const duplicados = recientes?.filter(msg => esMensajePanel(key, msg) && msg.id !== mensaje.id) || [];
    for (const [, msg] of duplicados) {
      await msg.delete().catch(() => {});
    }
    return true;
  } catch (error) {
    console.error(`No se pudo publicar/editar el panel ${key} en ${channelId}:`, error.message);
    return false;
  }
}

async function publicarPaneles() {
  const paneles = [
    ["fichajes", config.CHANNELS.FICHAJES, "FICHAJES_CHANNEL_ID o CHANNEL_ID"],
    ["pagos", config.CHANNELS.PAGOS, "PAGOS_CHANNEL_ID"],
    ["calculadora", config.CHANNELS.CALCULADORA, "CALCULADORA_CHANNEL_ID"],
    ["postulantes", config.CHANNELS.POSTULANTES, "POSTULANTES_CHANNEL_ID"]
  ];

  let publicados = 0;
  for (const [key, channelId, variable] of paneles) {
    if (!channelId) {
      console.warn(`Panel ${key} no publicado: falta variable ${variable}.`);
      continue;
    }
    if (await publicarPanel(key, channelId)) publicados += 1;
  }
  return publicados;
}

function crearModalRangoTodos() {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:todos:rango`)
    .setTitle("Consultar todos por rango")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("desde").setLabel("Desde (YYYY-MM-DD)").setPlaceholder(formatDate(startOfWeek(new Date()))).setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("hasta").setLabel("Hasta (YYYY-MM-DD)").setPlaceholder(formatDate(new Date())).setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
}

function crearModalMisHorasRango() {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:mishoras:rango`)
    .setTitle("Mis horas por fechas")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("desde").setLabel("Desde (YYYY-MM-DD)").setPlaceholder(formatDate(startOfWeek(new Date()))).setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("hasta").setLabel("Hasta (YYYY-MM-DD)").setPlaceholder(formatDate(new Date())).setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
}

function crearModalRangoEmpleadoSeleccionado(userId) {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:empleado_rango:${userId}`)
    .setTitle("Consultar empleado por fechas")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("desde").setLabel("Desde (YYYY-MM-DD)").setPlaceholder(formatDate(startOfWeek(new Date()))).setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("hasta").setLabel("Hasta (YYYY-MM-DD)").setPlaceholder(formatDate(new Date())).setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
}

function crearModalEmpleado(tipoRango) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:empleado:${tipoRango}`)
    .setTitle(tipoRango === "rango" ? "Consultar empleado por rango" : "Consultar empleado")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("empleado").setLabel("Empleado: mención, ID o nombre").setPlaceholder("@Empleado o 123456789...").setStyle(TextInputStyle.Short).setRequired(true)
      )
    );

  if (tipoRango === "rango") {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("desde").setLabel("Desde (YYYY-MM-DD)").setPlaceholder(formatDate(startOfWeek(new Date()))).setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("hasta").setLabel("Hasta (YYYY-MM-DD)").setPlaceholder(formatDate(new Date())).setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
  }

  return modal;
}

function crearPanelGestionHorasEmpleado(data, userId) {
  const empleado = data.employees?.[userId] || {};
  const displayName = empleado.displayName || `Usuario ${userId}`;
  const semanal = calcularMinutosEmpleado(data, userId, rangoEstaSemana());
  const abierta = data.openShifts?.[userId];
  let estadoFichaje = "✅ Sin fichaje abierto";
  if (abierta?.start) {
    const inicio = new Date(abierta.start);
    const transcurrido = Math.max(0, Math.round((Date.now() - inicio.getTime()) / MINUTE));
    estadoFichaje = `🟠 Abierto desde **${formatDateTime(inicio)}** · ${minutosAHoras(transcurrido)}`;
  }

  const embed = new EmbedBuilder()
    .setColor(COLOR_AUTOEXOTIC_BLUE)
    .setTitle(`Gestión de horas · ${displayName}`.slice(0, 256))
    .setDescription(`**Esta semana:** ${minutosAHoras(semanal.minutos)}\n**Fichaje:** ${estadoFichaje}\n\nEl ajuste deja el total exacto que indiques para el periodo elegido.`)
    .setTimestamp();
  if (empleado.avatarURL) embed.setThumbnail(empleado.avatarURL);

  const components = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:gestion:${userId}:hoy`).setLabel("Ajustar hoy").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:gestion:${userId}:esta`).setLabel("Ajustar esta semana").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:gestion:${userId}:rango`).setLabel("Ajustar rango").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:gestion:${userId}:cerrar`).setLabel("Cerrar fichaje").setStyle(ButtonStyle.Danger).setDisabled(!abierta)
    )
  ];
  return { embeds: [embed], components };
}

function crearModalAjusteGestion(userId, tipo) {
  const modal = new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:ajustar:${tipo}:${userId}`)
    .setTitle(tipo === "hoy" ? "Ajustar horas de hoy" : tipo === "esta" ? "Ajustar esta semana" : "Ajustar rango de horas");

  if (tipo === "rango") {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("desde").setLabel("Desde (YYYY-MM-DD)").setValue(formatDate(startOfWeek(new Date()))).setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("hasta").setLabel("Hasta (YYYY-MM-DD)").setValue(formatDate(new Date())).setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
  }

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("horas").setLabel("Total final del periodo").setPlaceholder("Ej.: 8, 7.5, 7,5 o 07:30").setStyle(TextInputStyle.Short).setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("motivo").setLabel("Motivo / nota").setPlaceholder("Corrección manual").setStyle(TextInputStyle.Short).setRequired(false)
    )
  );
  return modal;
}

function crearModalCerrarFichajeEmpleado(data, userId) {
  const abierta = data.openShifts?.[userId];
  const inicio = abierta?.start ? new Date(abierta.start) : null;
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:cerrar_fichaje:${userId}`)
    .setTitle("Cerrar fichaje abierto")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("cierre")
          .setLabel("Fecha y hora de cierre")
          .setValue(formatDateTime(new Date()))
          .setPlaceholder("YYYY-MM-DD HH:MM")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("motivo")
          .setLabel("Motivo")
          .setValue(inicio ? `Fichaje olvidado desde ${formatDateTime(inicio)}`.slice(0, 100) : "Fichaje olvidado")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      )
    );
}

function crearModalModificarHoras() {
  const today = formatDate(new Date());
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:modificar_horas`)
    .setTitle("Modificar horas fichadas")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("empleado").setLabel("Empleado: mención, ID o nombre").setPlaceholder("@Empleado o 123456789...").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("desde").setLabel("Desde (YYYY-MM-DD)").setPlaceholder(today).setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("hasta").setLabel("Hasta (YYYY-MM-DD)").setPlaceholder(today).setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("horas").setLabel("Total exacto que debe quedar").setPlaceholder("Ejemplo: 8, 7.5 o 07:30").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("motivo").setLabel("Motivo / nota").setPlaceholder("Corrección manual").setStyle(TextInputStyle.Short).setRequired(false)
      )
    );
}

function crearModalModificarHorasEmpleado(userId) {
  const today = formatDate(new Date());
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:modificar_horas:${userId}`)
    .setTitle("Modificar horas empleado")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("desde").setLabel("Desde (YYYY-MM-DD)").setPlaceholder(today).setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("hasta").setLabel("Hasta (YYYY-MM-DD)").setPlaceholder(today).setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("horas").setLabel("Total exacto que debe quedar").setPlaceholder("Ejemplo: 8, 7.5 o 07:30").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("motivo").setLabel("Motivo / nota").setPlaceholder("Corrección manual").setStyle(TextInputStyle.Short).setRequired(false)
      )
    );
}

function crearModalPostulacion() {
  return new ModalBuilder()
    .setCustomId(`${PREFIX}:modal:postulacion`)
    .setTitle("Postulación Auto Exotic")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("nombre_ic").setLabel("Nombre IC").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("nombre_ooc").setLabel("Nombre OOC").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("edad").setLabel("Edad OOC").setStyle(TextInputStyle.Short).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("experiencia").setLabel("Experiencia").setStyle(TextInputStyle.Paragraph).setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("horario").setLabel("Horario disponible").setStyle(TextInputStyle.Short).setRequired(true)
      )
    );
}

function normalizarSesionCalculadora(session) {
  const normalizada = {
    quantities: {},
    mode: session?.mode === "remove" ? "remove" : "add",
    discount: Number.isFinite(Number(session?.discount)) ? Number(session.discount) : 0
  };

  if (session?.quantities && typeof session.quantities === "object") {
    for (const [itemId, cantidad] of Object.entries(session.quantities)) {
      const numero = Math.max(0, Math.floor(Number(cantidad) || 0));
      if (numero > 0) normalizada.quantities[itemId] = numero;
    }
  }

  // Compatibilidad con la versión anterior, que guardaba solo seleccionado/no seleccionado.
  if (session?.selected instanceof Set) {
    for (const itemId of session.selected) {
      if (!normalizada.quantities[itemId]) normalizada.quantities[itemId] = 1;
    }
  }

  return normalizada;
}

function obtenerSesionCalculadora(userId) {
  const session = normalizarSesionCalculadora(calcSessions.get(userId));
  calcSessions.set(userId, session);
  return session;
}

function cantidadCalculadora(session, itemId) {
  return Math.max(0, Math.floor(Number(session.quantities?.[itemId]) || 0));
}

function crearVistaCalculadora(userId) {
  const descuentos = [...new Set([0, ...(config.CALCULATOR_DISCOUNTS.length ? config.CALCULATOR_DISCOUNTS : [5, 10, 15])])]
    .filter(discount => Number.isFinite(Number(discount)))
    .map(Number)
    .filter(discount => discount >= 0 && discount <= 100)
    .slice(0, 4);

  // Discord permite máximo 5 filas y 5 botones por fila.
  // 19 servicios + Añadir/Quitar + 4 descuentos = 25 botones.
  // No se muestra Limpiar para poder mantener el botón 0% y todos los servicios.
  const items = config.CALCULATOR_ITEMS.slice(0, 19);
  const session = obtenerSesionCalculadora(userId);

  const seleccionados = items
    .map(item => ({ ...item, cantidad: cantidadCalculadora(session, item.id) }))
    .filter(item => item.cantidad > 0);

  const subtotal = seleccionados.reduce((acc, item) => acc + item.price * item.cantidad, 0);
  const total = Math.round(subtotal * (1 - (session.discount || 0) / 100));

  const detalle = seleccionados.length
    ? seleccionados.map(item => {
        const linea = item.cantidad > 1
          ? `${item.label} x${item.cantidad}: **${formatearDinero(item.price * item.cantidad)}** (${formatearDinero(item.price)} c/u)`
          : `${item.label}: **${formatearDinero(item.price)}**`;
        return `• ${linea}`;
      }).join("\n")
    : "No hay servicios añadidos. Pulsa **Añadir** y después el servicio que quieras sumar.";

  const embed = new EmbedBuilder()
    .setColor(COLOR_AUTOEXOTIC_BLUE)
    .setTitle("🧮 Calculadora Auto Exotic")
    .setDescription(limitarTexto(detalle, 1600))
    .addFields(
      { name: "Modo", value: session.mode === "remove" ? "**Quitar**" : "**Añadir**", inline: true },
      { name: "Subtotal", value: `**${formatearDinero(subtotal)}**`, inline: true },
      { name: "Descuento", value: `**${session.discount || 0}%**`, inline: true },
      { name: "Total", value: `**${formatearDinero(total)}**`, inline: true }
    )
    .setFooter({ text: "Elige Añadir o Quitar y pulsa servicios. Usa 0% para quitar el descuento." })
    .setTimestamp();

  const rows = [];
  for (let i = 0; i < items.length; i += 5) {
    const chunk = items.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder().addComponents(
        ...chunk.map(item => {
          const cantidad = cantidadCalculadora(session, item.id);
          const labelBase = cantidad > 0
            ? `${item.label} x${cantidad} · ${formatearDinero(item.price)}`
            : `${item.label} · ${formatearDinero(item.price)}`;
          return new ButtonBuilder()
            .setCustomId(`${PREFIX}:calc:item:${item.id}`)
            .setLabel(labelBase.slice(0, 80))
            .setStyle(cantidad > 0 ? ButtonStyle.Primary : ButtonStyle.Secondary);
        })
      )
    );
  }

  const botonAnadir = new ButtonBuilder()
    .setCustomId(`${PREFIX}:calc:modo:add`)
    .setLabel("Añadir")
    .setStyle(session.mode === "add" ? ButtonStyle.Primary : ButtonStyle.Secondary);

  const botonQuitar = new ButtonBuilder()
    .setCustomId(`${PREFIX}:calc:modo:remove`)
    .setLabel("Quitar")
    .setStyle(session.mode === "remove" ? ButtonStyle.Danger : ButtonStyle.Secondary);

  if (!rows.length) rows.push(new ActionRowBuilder().addComponents(botonAnadir));
  else {
    const ultimaFila = rows[rows.length - 1];
    if ((ultimaFila.components?.length || 0) < 5) ultimaFila.addComponents(botonAnadir);
    else rows.push(new ActionRowBuilder().addComponents(botonAnadir));
  }

  rows.push(new ActionRowBuilder().addComponents(
    botonQuitar,
    ...descuentos.slice(0, 4).map(discount =>
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:calc:descuento:${discount}`)
        .setLabel(`${discount}%`)
        .setStyle(session.discount === discount ? ButtonStyle.Primary : ButtonStyle.Primary)
    )
  ));

  return { embeds: [embed], components: rows.slice(0, 5) };
}

function crearSelectorCalculadora() {
  return crearVistaCalculadora("preview").components;
}

async function registrarComandos() {
  const comandos = [
    new SlashCommandBuilder()
      .setName("paneles")
      .setDescription("Republica/actualiza los paneles del bot."),
    new SlashCommandBuilder()
      .setName("horas")
      .setDescription("Consulta horas fichadas.")
      .addUserOption(option => option.setName("empleado").setDescription("Empleado. Si lo dejas vacío, consulta tus horas."))
      .addStringOption(option => option.setName("desde").setDescription("Fecha desde YYYY-MM-DD"))
      .addStringOption(option => option.setName("hasta").setDescription("Fecha hasta YYYY-MM-DD")),
    new SlashCommandBuilder()
      .setName("sethoras")
      .setDescription("Modifica las horas de un empleado en un rango.")
      .addUserOption(option => option.setName("empleado").setDescription("Empleado").setRequired(true))
      .addStringOption(option => option.setName("desde").setDescription("Fecha desde YYYY-MM-DD").setRequired(true))
      .addStringOption(option => option.setName("hasta").setDescription("Fecha hasta YYYY-MM-DD").setRequired(true))
      .addStringOption(option => option.setName("horas").setDescription("Total exacto: 8, 7.5 o 07:30").setRequired(true))
      .addStringOption(option => option.setName("motivo").setDescription("Motivo de la corrección"))
  ].map(command => command.toJSON());

  try {
    if (config.GUILD_ID) {
      const guild = await client.guilds.fetch(config.GUILD_ID);
      await guild.commands.set(comandos);
      console.log(`Comandos registrados en servidor ${config.GUILD_ID}.`);
    } else {
      await client.application.commands.set(comandos);
      console.log("Comandos globales registrados. Para cambios instantáneos, configura GUILD_ID.");
    }
  } catch (error) {
    console.error("No se pudieron registrar comandos:", error.message);
  }
}

function obtenerRangoPorTipo(tipo) {
  if (tipo === "esta") return rangoEstaSemana();
  if (tipo === "pasada") return rangoSemanaPasada();
  return null;
}

async function manejarEntrada(interaction) {
  if (!puedeFichar(interaction)) return sinPermiso(interaction);

  const data = cargarDatos();
  const userId = interaction.user.id;
  const displayName = nombreMiembro(interaction);
  touchEmpleado(data, userId, displayName, { avatarURL: avatarUsuario(interaction.member || interaction.user) });

  if (data.openShifts[userId]) {
    const inicio = new Date(data.openShifts[userId].start);
    guardarDatos(data);
    return responderError(interaction, `Ya tienes una entrada abierta desde **${formatDateTime(inicio)}**.`);
  }

  data.openShifts[userId] = {
    userId,
    displayName,
    start: new Date().toISOString()
  };
  guardarDatos(data);
  await enviarLog(`**Entrada** · ${displayName} (<@${userId}>) · ${formatDateTime(new Date())}`);
  return responderOk(interaction, `Entrada registrada a las **${formatTime(new Date())}**.`);
}

async function manejarSalida(interaction) {
  if (!puedeFichar(interaction)) return sinPermiso(interaction);

  const data = cargarDatos();
  const userId = interaction.user.id;
  const displayName = nombreMiembro(interaction);
  touchEmpleado(data, userId, displayName, { avatarURL: avatarUsuario(interaction.member || interaction.user) });

  const abierta = data.openShifts[userId];
  if (!abierta) return responderError(interaction, "No tienes ninguna entrada abierta.");

  const fin = new Date();
  const inicio = new Date(abierta.start);
  const minutos = Math.max(0, Math.round((fin.getTime() - inicio.getTime()) / MINUTE));

  data.entries.push({
    id: generarId("shift"),
    type: "shift",
    userId,
    displayName,
    start: abierta.start,
    end: fin.toISOString(),
    createdAt: fin.toISOString()
  });
  delete data.openShifts[userId];
  guardarDatos(data);

  await enviarLog(`**Salida** · ${displayName} (<@${userId}>) · ${formatDateTime(fin)} · Turno: **${minutosAHoras(minutos)}**`);
  return responderOk(interaction, `Salida registrada. Turno total: **${minutosAHoras(minutos)}**.`);
}

async function manejarMisHoras(interaction) {
  const data = cargarDatos();
  const userId = interaction.user.id;
  touchEmpleado(data, userId, nombreMiembro(interaction), { avatarURL: avatarUsuario(interaction.member || interaction.user) });
  guardarDatos(data);

  return interaction.reply(respuestaPrivada({
    content: "Elige qué horas quieres consultar:",
    components: crearOpcionesMisHoras()
  }));
}

async function consultarMisHoras(interaction, range) {
  const data = cargarDatos();
  const userId = interaction.user.id;
  touchEmpleado(data, userId, nombreMiembro(interaction), { avatarURL: avatarUsuario(interaction.member || interaction.user) });
  guardarDatos(data);

  return interaction.reply(respuestaPrivada({
    embeds: [embedEmpleado(data, userId, range, `Mis horas · ${range.label}`)]
  }));
}

async function consultarTodos(interaction, range) {
  const data = cargarDatos();
  const empleados = await obtenerEmpleadosGuild(interaction, data);
  return interaction.reply(respuestaPrivada({ embeds: [embedTodosDesdeLista(data, empleados, range, `Todos los empleados · ${range.label}`)] }));
}

async function consultarEmpleado(interaction, empleadoTexto, range) {
  const data = cargarDatos();
  const empleado = await resolverEmpleado(interaction, empleadoTexto, data);
  if (empleado.error) return responderError(interaction, empleado.error);
  guardarDatos(data);
  return interaction.reply(respuestaPrivada({ embeds: [embedEmpleado(data, empleado.userId, range, `Empleado · ${range.label}`)] }));
}

async function aplicarTotalHorasEmpleado(interaction, empleado, range, horasTexto, motivo = "") {
  const minutosDeseados = parseHoras(horasTexto);
  if (minutosDeseados === null || minutosDeseados < 0) return responderError(interaction, "Horas no válidas. Usa 8, 7.5, 7,5 o 07:30.");

  const data = cargarDatos();
  const abierta = data.openShifts?.[empleado.userId];
  if (abierta?.start) {
    const openStart = new Date(abierta.start).getTime();
    if (Number.isFinite(openStart) && openStart < range.endExclusive.getTime() && Date.now() >= range.start.getTime()) {
      return responderError(interaction, "Ese empleado tiene un fichaje abierto dentro del periodo. Ciérralo primero desde esta misma gestión y después ajusta el total.");
    }
  }
  const actual = calcularMinutosEmpleado(data, empleado.userId, range).minutos;
  const delta = minutosDeseados - actual;
  const nota = String(motivo || "Corrección manual").trim().slice(0, 80);

  if (delta !== 0) {
    data.entries.push({
      id: generarId("adjust"),
      type: "adjustment",
      userId: empleado.userId,
      displayName: empleado.displayName,
      date: formatDate(endInclusive(range)),
      minutes: delta,
      note: nota,
      createdAt: new Date().toISOString(),
      editedBy: interaction.user.id,
      editedByName: nombreMiembro(interaction),
      targetRange: { desde: formatDate(range.start), hasta: formatDate(endInclusive(range)) },
      targetTotalMinutes: minutosDeseados
    });
  }

  guardarDatos(data);
  await enviarLog(`🛠️ **Horas modificadas** · ${empleado.displayName} (<@${empleado.userId}>) · ${etiquetaRango(range)} · Antes: **${minutosAHoras(actual)}** · Ahora: **${minutosAHoras(minutosDeseados)}** · Ajuste: **${minutosAHoras(delta)}** · Por ${nombreMiembro(interaction)}`);

  return interaction.reply(respuestaPrivada({
    content: delta === 0
      ? "✅ El total ya coincidía; no se ha creado ningún ajuste."
      : `✅ Total actualizado a **${minutosAHoras(minutosDeseados)}**. Ajuste aplicado: **${minutosAHoras(delta)}**.`,
    embeds: [embedEmpleado(data, empleado.userId, range, "Resultado del ajuste")]
  }));
}

async function modificarHorasEmpleado(interaction, empleadoTexto, desde, hasta, horasTexto, motivo = "") {
  if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
  const range = rangoDesdeHasta(desde, hasta);
  if (!range) return responderError(interaction, "Rango no válido. Usa fechas con formato YYYY-MM-DD y asegúrate de que `hasta` no sea anterior a `desde`.");

  const data = cargarDatos();
  const empleado = await resolverEmpleado(interaction, empleadoTexto, data);
  if (empleado.error) return responderError(interaction, empleado.error);
  guardarDatos(data);
  return aplicarTotalHorasEmpleado(interaction, empleado, range, horasTexto, motivo);
}

async function modificarHorasEmpleadoRango(interaction, userId, range, horasTexto, motivo = "") {
  if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
  const data = cargarDatos();
  const empleado = await resolverEmpleado(interaction, userId, data);
  if (empleado.error) return responderError(interaction, empleado.error);
  guardarDatos(data);
  return aplicarTotalHorasEmpleado(interaction, empleado, range, horasTexto, motivo);
}

async function cerrarFichajeEmpleadoGestion(interaction, userId, cierreTexto, motivo = "") {
  if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
  const data = cargarDatos();
  const empleado = await resolverEmpleado(interaction, userId, data);
  if (empleado.error) return responderError(interaction, empleado.error);
  const abierta = data.openShifts?.[userId];
  if (!abierta?.start) return responderError(interaction, "Ese empleado ya no tiene ningún fichaje abierto.");

  const fin = parseDateTimeLocal(cierreTexto);
  if (!fin) return responderError(interaction, "Fecha/hora no válida. Usa `YYYY-MM-DD HH:MM`, por ejemplo `2026-09-05 18:30`.");
  const inicio = new Date(abierta.start);
  if (fin < inicio) return responderError(interaction, `El cierre no puede ser anterior a la entrada (${formatDateTime(inicio)}).`);
  if (fin.getTime() > Date.now() + 5 * MINUTE) return responderError(interaction, "La hora de cierre no puede estar en el futuro.");

  const cierre = cerrarFichajeAbierto(data, userId, {
    endAt: fin,
    displayName: empleado.displayName,
    reason: String(motivo || "Cierre manual de fichaje olvidado").trim(),
    automatic: false,
    closedBy: interaction.user.id,
    closedByName: nombreMiembro(interaction)
  });
  guardarDatos(data);
  await enviarLog(`🔒 **Fichaje cerrado manualmente** · ${empleado.displayName} (<@${userId}>) · ${formatDateTime(cierre.inicio)} → ${formatDateTime(cierre.fin)} · **${minutosAHoras(cierre.minutos)}** · Por ${nombreMiembro(interaction)}`);

  return interaction.reply(respuestaPrivada({
    content: `✅ Fichaje cerrado. Turno guardado: **${minutosAHoras(cierre.minutos)}**.`,
    ...crearPanelGestionHorasEmpleado(data, userId)
  }));
}

async function manejarComandoHoras(interaction) {
  const user = interaction.options.getUser("empleado");
  const desde = interaction.options.getString("desde");
  const hasta = interaction.options.getString("hasta");
  const range = desde || hasta ? rangoDesdeHasta(desde, hasta) : rangoEstaSemana();
  if (!range) return responderError(interaction, "Rango no válido. Usa YYYY-MM-DD en `desde` y `hasta`." );

  const userId = user?.id || interaction.user.id;
  if (userId !== interaction.user.id && !puedeGestionarPagos(interaction)) return sinPermiso(interaction);

  const data = cargarDatos();
  let displayName = user?.globalName || user?.username || data.employees?.[userId]?.displayName || `Usuario ${userId}`;
  try {
    const member = await interaction.guild?.members.fetch(userId);
    if (member?.displayName) displayName = member.displayName;
  } catch {}
  touchEmpleado(data, userId, displayName, { avatarURL: avatarUsuario(user || interaction.member || interaction.user) });
  guardarDatos(data);

  return interaction.reply(respuestaPrivada({ embeds: [embedEmpleado(data, userId, range, userId === interaction.user.id ? "Mis horas" : "Horas de empleado")] }));
}

async function manejarComandoSetHoras(interaction) {
  if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
  const user = interaction.options.getUser("empleado", true);
  const desde = interaction.options.getString("desde", true);
  const hasta = interaction.options.getString("hasta", true);
  const horas = interaction.options.getString("horas", true);
  const motivo = interaction.options.getString("motivo") || "Corrección manual";
  return modificarHorasEmpleado(interaction, user.id, desde, hasta, horas, motivo);
}

async function manejarCalculadora(interaction) {
  calcSessions.set(interaction.user.id, { quantities: {}, mode: "add", discount: 0 });
  return interaction.reply(respuestaPrivada(crearVistaCalculadora(interaction.user.id)));
}

async function manejarSelectorCalculadora(interaction) {
  const session = obtenerSesionCalculadora(interaction.user.id);
  session.quantities = {};
  for (const itemId of interaction.values || []) session.quantities[itemId] = 1;
  calcSessions.set(interaction.user.id, session);
  return interaction.update(crearVistaCalculadora(interaction.user.id));
}

async function manejarBotonCalculadora(interaction, id) {
  const session = obtenerSesionCalculadora(interaction.user.id);

  if (id === `${PREFIX}:calc:limpiar`) {
    session.quantities = {};
    session.mode = "add";
    session.discount = 0;
  } else if (id === `${PREFIX}:calc:modo:add`) {
    session.mode = "add";
  } else if (id === `${PREFIX}:calc:modo:remove`) {
    session.mode = "remove";
  } else if (id.startsWith(`${PREFIX}:calc:descuento:`)) {
    const value = Number(id.replace(`${PREFIX}:calc:descuento:`, ""));
    session.discount = Number.isFinite(value) ? value : 0;
  } else if (id.startsWith(`${PREFIX}:calc:item:`)) {
    const itemId = id.replace(`${PREFIX}:calc:item:`, "");
    const existe = config.CALCULATOR_ITEMS.some(item => item.id === itemId);
    if (existe) {
      const actual = cantidadCalculadora(session, itemId);
      if (session.mode === "remove") {
        const nuevo = Math.max(0, actual - 1);
        if (nuevo > 0) session.quantities[itemId] = nuevo;
        else delete session.quantities[itemId];
      } else {
        session.quantities[itemId] = actual + 1;
      }
    }
  }

  calcSessions.set(interaction.user.id, session);
  return interaction.update(crearVistaCalculadora(interaction.user.id));
}

function crearEmbedPostulacion(app) {
  return new EmbedBuilder()
    .setColor(COLOR_AUTOEXOTIC_BLUE)
    .setTitle("🏁 Nueva postulación Auto Exotic")
    .setDescription(`Usuario: <@${app.userId}>`)
    .addFields(
      { name: "Nombre IC", value: app.nombreIc || "-", inline: true },
      { name: "Nombre OOC", value: app.nombreOoc || "-", inline: true },
      { name: "Edad OOC", value: app.edad || "-", inline: true },
      { name: "Horario", value: app.horario || "-", inline: false },
      { name: "Experiencia", value: limitarTexto(app.experiencia || "-", 900), inline: false },
      { name: "Estado", value: app.status || "pendiente", inline: true }
    )
    .setTimestamp(new Date(app.createdAt || Date.now()));
}

function crearBotonesRevisionPostulacion(appId, disabled = false) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:app:aceptar:${appId}`).setLabel("Aceptar").setStyle(ButtonStyle.Primary).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`${PREFIX}:app:denegar:${appId}`).setLabel("Denegar").setStyle(ButtonStyle.Danger).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`${PREFIX}:app:cerrar:${appId}`).setLabel("Cerrar ticket").setStyle(ButtonStyle.Danger)
    )
  ];
}

async function obtenerCategoriaPostulaciones(interaction) {
  if (config.CHANNELS.APPLICATION_CATEGORY) return config.CHANNELS.APPLICATION_CATEGORY;
  try {
    const canalPostulantes = config.CHANNELS.POSTULANTES
      ? await client.channels.fetch(config.CHANNELS.POSTULANTES).catch(() => null)
      : null;
    return canalPostulantes?.parentId || null;
  } catch {
    return null;
  }
}

async function crearCanalTicketPostulacion(interaction, app) {
  const guild = interaction.guild;
  if (!guild) throw new Error("No se encontró el servidor de Discord.");

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has(PermissionsBitField.Flags.ManageChannels)) {
    throw new Error("Al bot le falta el permiso Gestionar canales para crear tickets de postulación.");
  }

  const reviewerRoles = rolesRevisoresPostulaciones();
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: app.userId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    },
    {
      id: client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels]
    },
    ...reviewerRoles.map(roleId => ({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    }))
  ];

  const parent = await obtenerCategoriaPostulaciones(interaction);
  const channel = await guild.channels.create({
    name: `${config.APPLICATION_TICKET_PREFIX || "postulacion"}-${limpiarNombreCanal(app.nombreIc)}-${String(app.userId).slice(-4)}`.slice(0, 95),
    type: ChannelType.GuildText,
    parent: parent || undefined,
    permissionOverwrites: overwrites,
    topic: `Postulación Auto Exotic de ${app.displayName} · ${app.userId}`
  });

  const pingRevisores = reviewerRoles.length ? reviewerRoles.map(id => `<@&${id}>`).join(" ") : "";
  const mensaje = await channel.send({
    content: `${pingRevisores}\nPostulación de <@${app.userId}>`.trim(),
    embeds: [crearEmbedPostulacion(app)],
    components: crearBotonesRevisionPostulacion(app.id)
  });

  return { channel, message: mensaje };
}

async function manejarPostulacion(interaction) {
  const data = cargarDatos();
  const id = generarId("app");
  const app = {
    id,
    userId: interaction.user.id,
    displayName: nombreMiembro(interaction),
    avatarURL: avatarUsuario(interaction.member || interaction.user),
    nombreIc: interaction.fields.getTextInputValue("nombre_ic"),
    nombreOoc: interaction.fields.getTextInputValue("nombre_ooc"),
    edad: interaction.fields.getTextInputValue("edad"),
    experiencia: interaction.fields.getTextInputValue("experiencia"),
    horario: interaction.fields.getTextInputValue("horario"),
    status: "pendiente",
    createdAt: new Date().toISOString()
  };

  data.applications[id] = app;

  try {
    const { channel, message } = await crearCanalTicketPostulacion(interaction, app);
    app.ticketChannelId = channel.id;
    app.ticketMessageId = message.id;
    data.applications[id] = app;
    touchEmpleado(data, app.userId, app.nombreIc || app.displayName, { avatarURL: app.avatarURL || null });
    guardarDatos(data);

    await enviarLog(`📨 **Nueva postulación** · ${app.nombreIc} (<@${app.userId}>) · Ticket: <#${channel.id}>`);
    return responderOk(interaction, `Postulación creada correctamente: <#${channel.id}>`);
  } catch (error) {
    data.applications[id] = app;
    guardarDatos(data);
    console.error("No se pudo crear el ticket de postulación:", error.message);

    if (config.CHANNELS.LOGS) {
      const logChannel = await client.channels.fetch(config.CHANNELS.LOGS).catch(() => null);
      if (logChannel?.isTextBased()) {
        await logChannel.send({
          content: `⚠️ No se pudo crear ticket de postulación: ${error.message}`,
          embeds: [crearEmbedPostulacion(app)],
          components: crearBotonesRevisionPostulacion(app.id)
        }).catch(() => {});
      }
    }

    return responderError(interaction, `No se pudo crear el ticket de postulación. Revisa permisos del bot: ${error.message}`);
  }
}

async function manejarDecisionPostulacion(interaction, appId, accion) {
  if (!puedeRevisarPostulaciones(interaction)) return sinPermiso(interaction);

  const data = cargarDatos();
  const app = data.applications?.[appId];
  if (!app) return responderError(interaction, "No encontré esta postulación en el archivo de datos.");
  if (app.status && app.status !== "pendiente") return responderError(interaction, `Esta postulación ya está marcada como ${app.status}.`);

  const aceptada = accion === "aceptar";
  app.status = aceptada ? "aceptada" : "denegada";
  app.reviewedAt = new Date().toISOString();
  app.reviewedBy = interaction.user.id;
  app.reviewedByName = nombreMiembro(interaction);

  let detalleRoles = "";
  if (aceptada) {
    const roleIds = rolesAceptarPostulacion();
    try {
      const member = await interaction.guild.members.fetch(app.userId);
      for (const roleId of roleIds) {
        await member.roles.add(roleId).catch(error => {
          detalleRoles += `\n⚠️ No pude asignar <@&${roleId}>: ${error.message}`;
        });
      }
      for (const roleId of rolesAplicablesPostulante()) {
        if (member.roles.cache.has(roleId)) {
          await member.roles.remove(roleId).catch(error => {
            detalleRoles += `\n⚠️ No pude quitar <@&${roleId}>: ${error.message}`;
          });
        }
      }
      if (config.APPLICATION_CHANGE_NICKNAME && app.nombreIc) {
        await member.setNickname(app.nombreIc).catch(error => {
          detalleRoles += `\n⚠️ No pude cambiar el apodo: ${error.message}`;
        });
      }
      touchEmpleado(data, app.userId, app.nombreIc || app.displayName, { avatarURL: app.avatarURL || null });
    } catch (error) {
      detalleRoles += `\n⚠️ No pude encontrar/asignar al usuario: ${error.message}`;
    }

    if (!roleIds.length) {
      detalleRoles += "\n⚠️ No hay APPLICATION_ACCEPT_ROLE_IDS configurado. No se asignó rol.";
    }
  }

  data.applications[appId] = app;
  guardarDatos(data);

  const texto = aceptada
    ? `✅ Postulación aceptada por ${nombreMiembro(interaction)}.${detalleRoles}`
    : `❌ Postulación denegada por ${nombreMiembro(interaction)}.`;

  await interaction.update({ components: crearBotonesRevisionPostulacion(appId, true) }).catch(() => {});
  await interaction.followUp({ content: texto }).catch(() => {});
  await enviarLog(`${aceptada ? "✅" : "❌"} **Postulación ${app.status}** · ${app.nombreIc} (<@${app.userId}>) · Por ${nombreMiembro(interaction)}${detalleRoles}`);

  if (config.APPLICATION_DELETE_TICKET_ON_DECISION && interaction.channel?.deletable) {
    setTimeout(() => interaction.channel.delete(`Postulación ${app.status}`).catch(() => {}), 8000);
  }
}

async function manejarCerrarTicketPostulacion(interaction, appId) {
  const data = cargarDatos();
  const app = data.applications?.[appId];
  const esCreador = app?.userId === interaction.user.id;
  if (!esCreador && !puedeRevisarPostulaciones(interaction)) return sinPermiso(interaction);
  await interaction.reply(respuestaPrivada({ content: "Ticket cerrado. Se eliminará el canal en unos segundos." })).catch(() => {});
  await enviarLog(`🗑️ **Ticket de postulación cerrado** · ${app?.nombreIc || "sin datos"} · Por ${nombreMiembro(interaction)}`);
  if (interaction.channel?.deletable) {
    setTimeout(() => interaction.channel.delete(`Ticket de postulación cerrado por ${nombreMiembro(interaction)}`).catch(() => {}), 3000);
  }
}

async function enviarBienvenida(member) {
  const data = cargarDatos();
  const roleIds = rolesAplicablesPostulante();
  const asignados = [];
  for (const roleId of roleIds) {
    try {
      await member.roles.add(roleId, "Rol automático al entrar al servidor");
      asignados.push(roleId);
    } catch (error) {
      console.warn(`No se pudo asignar rol de entrada ${roleId} a ${member.user?.tag || member.id}:`, error.message);
    }
  }

  guardarDatos(data);

  const channelId = config.CHANNELS.WELCOME || config.CHANNELS.POSTULANTES || config.CHANNELS.LOGS;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLOR_AUTOEXOTIC_BLUE)
      .setTitle("Bienvenido/a a Auto Exotic")
      .setDescription(`Bienvenido/a ${member}.

Pásate por postulaciones para crear tu solicitud.`)
      .setThumbnail(avatarUsuario(member))
      .setTimestamp()
    ]
  }).catch(error => console.warn("No se pudo enviar bienvenida:", error.message));
}

async function registrarSalidaMiembro(member) {
  const data = cargarDatos();
  const userId = member.id;
  const displayName = data.employees?.[userId]?.displayName || data.openShifts?.[userId]?.displayName || nombreDesdeMember(member);
  const cierre = retirarEmpleadoActivo(data, userId, {
    displayName,
    endAt: new Date(),
    reason: "El usuario ha salido del servidor",
    automatic: true
  });
  guardarDatos(data);
  employeeGuildCache.delete(member.guild.id);

  if (cierre) {
    await enviarLog(`🔒 **Fichaje cerrado automáticamente** · ${displayName} (<@${userId}>) · Salió del servidor · Turno: **${minutosAHoras(cierre.minutos)}**`);
  }

  const channelId = config.CHANNELS.GOODBYE || config.CHANNELS.LOGS;
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({
    embeds: [new EmbedBuilder()
      .setColor(COLOR_WARNING_RED)
      .setTitle("Salida del servidor")
      .setDescription(`**${displayName}** ha salido del servidor. Se ha retirado del censo activo${cierre ? " y su fichaje se ha cerrado" : ""}.`)
      .setTimestamp()
    ]
  }).catch(() => {});
}

async function registrarCambioRolesEmpleado(oldMember, newMember) {
  const antes = memberTieneRolEmpleado(oldMember);
  const ahora = memberTieneRolEmpleado(newMember);
  if (antes === ahora) return;

  const data = cargarDatos();
  employeeGuildCache.delete(newMember.guild.id);

  if (ahora) {
    const roleIds = rolesEmpleadosConfigurados().filter(roleId => newMember.roles.cache.has(roleId));
    const roleNames = roleIds.map(roleId => newMember.guild.roles.cache.get(roleId)?.name || "Rol").filter(Boolean);
    touchEmpleado(data, newMember.id, nombreDesdeMember(newMember), {
      avatarURL: avatarUsuario(newMember),
      roleIds,
      roleNames
    });
    guardarDatos(data);
    await enviarLog(`👤 **Empleado añadido al censo activo** · ${nombreDesdeMember(newMember)} (<@${newMember.id}>)`);
    return;
  }

  const displayName = data.employees?.[newMember.id]?.displayName || nombreDesdeMember(newMember);
  const cierre = retirarEmpleadoActivo(data, newMember.id, {
    displayName,
    endAt: new Date(),
    reason: "Se ha retirado el rol de empleado",
    automatic: true
  });
  guardarDatos(data);
  await enviarLog(`👤 **Empleado retirado del censo activo** · ${displayName} (<@${newMember.id}>)${cierre ? ` · Fichaje cerrado: **${minutosAHoras(cierre.minutos)}**` : ""}`);
}

let employeeSyncTimer = null;
async function sincronizarEmpleadosAlArrancar() {
  const guilds = config.GUILD_ID
    ? [await client.guilds.fetch(config.GUILD_ID).catch(() => null)].filter(Boolean)
    : [...client.guilds.cache.values()];

  for (const guild of guilds) {
    const data = cargarDatos();
    const result = await sincronizarCensoEmpleadosGuild(guild, data);
    if (result.ok && (result.retirados || result.cerrados)) {
      console.log(`Censo Auto Exotic sincronizado: ${result.activos.length} activos, ${result.retirados} retirados, ${result.cerrados} fichajes cerrados.`);
    }
  }
}

function iniciarSincronizacionPeriodicaEmpleados() {
  if (employeeSyncTimer) clearInterval(employeeSyncTimer);
  employeeSyncTimer = setInterval(() => {
    sincronizarEmpleadosAlArrancar().catch(error => console.error("Error sincronizando empleados:", error));
  }, Math.max(1, Number(config.EMPLOYEE_SYNC_MINUTES || 15)) * 60 * 1000);
  employeeSyncTimer.unref?.();
}

client.once(Events.ClientReady, async () => {
  logDatos();
  logConfiguracionPaneles();

  if (config.BOT_USERNAME && client.user?.username !== config.BOT_USERNAME) {
    try {
      await client.user.setUsername(config.BOT_USERNAME);
      console.log(`Nombre del bot actualizado a ${config.BOT_USERNAME}.`);
    } catch (error) {
      console.warn(`No se pudo cambiar automáticamente el nombre del bot a ${config.BOT_USERNAME}:`, error.message);
    }
  }

  console.log(`Bot conectado como ${client.user.tag}`);
  await registrarComandos();
  await sincronizarEmpleadosAlArrancar();
  iniciarSincronizacionPeriodicaEmpleados();

  if (config.AUTO_PUBLISH_PANELS) {
    const publicados = await publicarPaneles();
    console.log(`Paneles publicados/actualizados: ${publicados}.`);
  } else {
    console.log("AUTO_PUBLISH_PANELS=false. No se publican paneles al iniciar. Usa /paneles para publicarlos manualmente.");
  }
});


client.on(Events.GuildMemberAdd, async member => {
  await enviarBienvenida(member).catch(error => console.error("Error en bienvenida:", error));
});

client.on(Events.GuildMemberRemove, async member => {
  await registrarSalidaMiembro(member).catch(error => console.error("Error registrando salida:", error));
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  await registrarCambioRolesEmpleado(oldMember, newMember).catch(error => console.error("Error sincronizando cambio de roles:", error));
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "paneles") {
        if (!esAdminOEncargado(interaction) && !puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const publicados = await publicarPaneles();
        return responderOk(interaction, `Paneles actualizados: **${publicados}**.`);
      }

      if (interaction.commandName === "horas") return manejarComandoHoras(interaction);
      if (interaction.commandName === "sethoras") return manejarComandoSetHoras(interaction);
    }

    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === `${PREFIX}:ficha:entrada`) return manejarEntrada(interaction);
      if (id === `${PREFIX}:ficha:salida`) return manejarSalida(interaction);
      if (id === `${PREFIX}:ficha:mishoras`) return manejarMisHoras(interaction);
      if (id === `${PREFIX}:ficha:mishoras:esta`) return consultarMisHoras(interaction, rangoEstaSemana());
      if (id === `${PREFIX}:ficha:mishoras:pasada`) return consultarMisHoras(interaction, rangoSemanaPasada());
      if (id === `${PREFIX}:ficha:mishoras:rango`) return interaction.showModal(crearModalMisHorasRango());

      if (id.startsWith(`${PREFIX}:pagos:emp:`)) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const partes = id.split(":");
        const userId = partes[3];
        const tipo = partes[4];
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        if (tipo === "rango") return interaction.showModal(crearModalRangoEmpleadoSeleccionado(userId));
        const range = obtenerRangoPorTipo(tipo);
        if (!range) return responderError(interaction, "Rango no válido.");
        return consultarEmpleado(interaction, userId, range);
      }

      if (id.startsWith(`${PREFIX}:pagos:gestion:`)) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const partes = id.split(":");
        const userId = partes[3];
        const accion = partes[4];
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        if (accion === "hoy" || accion === "esta" || accion === "rango") return interaction.showModal(crearModalAjusteGestion(userId, accion));
        if (accion === "cerrar") {
          const data = cargarDatos();
          if (!data.openShifts?.[userId]) return responderError(interaction, "Ese empleado ya no tiene ningún fichaje abierto.");
          return interaction.showModal(crearModalCerrarFichajeEmpleado(data, userId));
        }
      }

      if (id === `${PREFIX}:pagos:consultar`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const data = cargarDatos();
        const { rows: components, empleados } = await crearOpcionesConsultaPagos(interaction, data);
        return interaction.reply(respuestaPrivada({
          content: empleados.length
            ? "Elige qué quieres consultar:"
            : "No hay empleados con los roles configurados todavía.",
          components
        }));
      }

      if (id === `${PREFIX}:pagos:modificar`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const data = cargarDatos();
        const { rows: components, empleados } = await crearSelectorModificarHoras(interaction, data);
        return interaction.reply(respuestaPrivada({
          content: components.length
            ? "Selecciona el empleado al que quieres modificar horas:"
            : "No hay empleados con los roles configurados todavía.",
          components
        }));
      }

      if (id === `${PREFIX}:pagos:todos:esta`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        return consultarTodos(interaction, rangoEstaSemana());
      }

      if (id === `${PREFIX}:pagos:todos:pasada`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        return consultarTodos(interaction, rangoSemanaPasada());
      }

      if (id === `${PREFIX}:pagos:todos:rango`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        return interaction.showModal(crearModalRangoTodos());
      }

      if (id === `${PREFIX}:pagos:empleado:esta`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        return interaction.showModal(crearModalEmpleado("esta"));
      }

      if (id === `${PREFIX}:pagos:empleado:pasada`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        return interaction.showModal(crearModalEmpleado("pasada"));
      }

      if (id === `${PREFIX}:pagos:empleado:rango`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        return interaction.showModal(crearModalEmpleado("rango"));
      }

      if (id === `${PREFIX}:calc:abrir`) return manejarCalculadora(interaction);
      if (id === `${PREFIX}:calc:limpiar` || id.startsWith(`${PREFIX}:calc:modo:`) || id.startsWith(`${PREFIX}:calc:descuento:`) || id.startsWith(`${PREFIX}:calc:item:`)) return manejarBotonCalculadora(interaction, id);
      if (id === `${PREFIX}:postular:abrir`) return interaction.showModal(crearModalPostulacion());

      if (id.startsWith(`${PREFIX}:app:aceptar:`)) {
        return manejarDecisionPostulacion(interaction, id.replace(`${PREFIX}:app:aceptar:`, ""), "aceptar");
      }

      if (id.startsWith(`${PREFIX}:app:denegar:`)) {
        return manejarDecisionPostulacion(interaction, id.replace(`${PREFIX}:app:denegar:`, ""), "denegar");
      }

      if (id.startsWith(`${PREFIX}:app:cerrar:`)) {
        return manejarCerrarTicketPostulacion(interaction, id.replace(`${PREFIX}:app:cerrar:`, ""));
      }
    }

    if (interaction.isUserSelectMenu?.()) {
      if (interaction.customId === `${PREFIX}:pagos:select:consultar`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const userId = interaction.values?.[0];
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        const data = cargarDatos();
        let displayName = data.employees?.[userId]?.displayName || `Usuario ${userId}`;
        try {
          const member = await interaction.guild?.members.fetch(userId);
          if (member?.displayName) displayName = member.displayName;
        } catch {}
        touchEmpleado(data, userId, displayName, { avatarURL: avatarUsuario(interaction.guild?.members?.cache?.get(userId)) });
        guardarDatos(data);
        const empleado = data.employees?.[userId];
        return interaction.reply(respuestaPrivada({
          content: `Empleado seleccionado: **${empleado?.displayName || "Empleado"}**. Elige el periodo:`,
          components: crearOpcionesRangoEmpleado(userId)
        }));
      }

      if (interaction.customId === `${PREFIX}:pagos:select:modificar`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const userId = interaction.values?.[0];
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        const data = cargarDatos();
        const member = await obtenerMiembroSeguro(interaction.guild, userId);
        if (!member || (rolesEmpleadosConfigurados().length && !memberTieneRolEmpleado(member))) return responderError(interaction, "Ese usuario ya no es un empleado activo.");
        return interaction.reply(respuestaPrivada(crearPanelGestionHorasEmpleado(data, userId)));
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === `${PREFIX}:calc:items`) return manejarSelectorCalculadora(interaction);

      if (interaction.customId.startsWith(`${PREFIX}:pagos:selectempleado:consultar:`)) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const userId = interaction.values?.[0];
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        const data = cargarDatos();
        let displayName = data.employees?.[userId]?.displayName || "Empleado";
        let avatarURL = data.employees?.[userId]?.avatarURL || null;
        const member = await obtenerMiembroSeguro(interaction.guild, userId);
        if (member) {
          displayName = nombreDesdeMember(member);
          avatarURL = avatarUsuario(member);
        }
        touchEmpleado(data, userId, displayName, { avatarURL });
        guardarDatos(data);
        return interaction.reply(respuestaPrivada({
          content: `Empleado seleccionado: **${displayName}**. Elige el periodo:`,
          components: crearOpcionesRangoEmpleado(userId)
        }));
      }

      if (interaction.customId.startsWith(`${PREFIX}:pagos:selectempleado:modificar:`)) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const userId = interaction.values?.[0];
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        const data = cargarDatos();
        const member = await obtenerMiembroSeguro(interaction.guild, userId);
        if (!member || (rolesEmpleadosConfigurados().length && !memberTieneRolEmpleado(member))) return responderError(interaction, "Ese usuario ya no es un empleado activo.");
        touchEmpleado(data, userId, nombreDesdeMember(member), { avatarURL: avatarUsuario(member) });
        guardarDatos(data);
        return interaction.reply(respuestaPrivada(crearPanelGestionHorasEmpleado(data, userId)));
      }
    }

    if (interaction.isModalSubmit()) {
      const id = interaction.customId;

      if (id === `${PREFIX}:modal:mishoras:rango`) {
        const range = rangoDesdeHasta(
          interaction.fields.getTextInputValue("desde"),
          interaction.fields.getTextInputValue("hasta")
        );
        if (!range) return responderError(interaction, "Rango no válido. Usa YYYY-MM-DD.");
        return consultarMisHoras(interaction, range);
      }

      if (id.startsWith(`${PREFIX}:modal:empleado_rango:`)) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const userId = id.replace(`${PREFIX}:modal:empleado_rango:`, "");
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        const range = rangoDesdeHasta(
          interaction.fields.getTextInputValue("desde"),
          interaction.fields.getTextInputValue("hasta")
        );
        if (!range) return responderError(interaction, "Rango no válido. Usa YYYY-MM-DD.");
        return consultarEmpleado(interaction, userId, range);
      }

      if (id === `${PREFIX}:modal:todos:rango`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const range = rangoDesdeHasta(
          interaction.fields.getTextInputValue("desde"),
          interaction.fields.getTextInputValue("hasta")
        );
        if (!range) return responderError(interaction, "Rango no válido. Usa YYYY-MM-DD.");
        return consultarTodos(interaction, range);
      }

      if (id.startsWith(`${PREFIX}:modal:empleado:`)) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const tipo = id.replace(`${PREFIX}:modal:empleado:`, "");
        let range = obtenerRangoPorTipo(tipo);
        if (tipo === "rango") {
          range = rangoDesdeHasta(
            interaction.fields.getTextInputValue("desde"),
            interaction.fields.getTextInputValue("hasta")
          );
        }
        if (!range) return responderError(interaction, "Rango no válido. Usa YYYY-MM-DD.");
        return consultarEmpleado(interaction, interaction.fields.getTextInputValue("empleado"), range);
      }

      if (id.startsWith(`${PREFIX}:modal:ajustar:`)) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const partes = id.split(":");
        const tipo = partes[3];
        const userId = partes[4];
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        let range = tipo === "hoy" ? rangoHoy() : tipo === "esta" ? rangoEstaSemana() : null;
        if (tipo === "rango") {
          range = rangoDesdeHasta(
            interaction.fields.getTextInputValue("desde"),
            interaction.fields.getTextInputValue("hasta")
          );
        }
        if (!range) return responderError(interaction, "Rango no válido.");
        return modificarHorasEmpleadoRango(
          interaction,
          userId,
          range,
          interaction.fields.getTextInputValue("horas"),
          interaction.fields.getTextInputValue("motivo")
        );
      }

      if (id.startsWith(`${PREFIX}:modal:cerrar_fichaje:`)) {
        const userId = id.replace(`${PREFIX}:modal:cerrar_fichaje:`, "");
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        return cerrarFichajeEmpleadoGestion(
          interaction,
          userId,
          interaction.fields.getTextInputValue("cierre"),
          interaction.fields.getTextInputValue("motivo")
        );
      }

      if (id.startsWith(`${PREFIX}:modal:modificar_horas:`)) {
        const userId = id.replace(`${PREFIX}:modal:modificar_horas:`, "");
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        return modificarHorasEmpleado(
          interaction,
          userId,
          interaction.fields.getTextInputValue("desde"),
          interaction.fields.getTextInputValue("hasta"),
          interaction.fields.getTextInputValue("horas"),
          interaction.fields.getTextInputValue("motivo")
        );
      }

      if (id === `${PREFIX}:modal:modificar_horas`) {
        return modificarHorasEmpleado(
          interaction,
          interaction.fields.getTextInputValue("empleado"),
          interaction.fields.getTextInputValue("desde"),
          interaction.fields.getTextInputValue("hasta"),
          interaction.fields.getTextInputValue("horas"),
          interaction.fields.getTextInputValue("motivo")
        );
      }

      if (id === `${PREFIX}:modal:postulacion`) return manejarPostulacion(interaction);
    }
  } catch (error) {
    console.error("Error procesando interacción:", error);
    const payload = respuestaPrivada({ content: "❌ Ha ocurrido un error al procesar la acción." });
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

if (!config.TOKEN) {
  console.error("Falta DISCORD_TOKEN. Créalo en Railway > Variables.");
  process.exit(1);
}

iniciarWeb(client);

client.login(config.TOKEN);