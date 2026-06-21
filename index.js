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

const calcSessions = new Map();

process.env.TZ = config.TIMEZONE || process.env.TZ || "Europe/Madrid";

const DATA_FILE_NAME = "topgear-data.json";
const PREFIX = "tg";
const MINUTE = 60 * 1000;
const MAX_DESCRIPTION = 3800;

// Tema visual Top Gear: verde/negro.
// Discord no permite botones negros personalizados, así que usamos:
// Success = verde, Primary = azul, Danger = rojo, Secondary = gris oscuro.
const COLOR_TOPGEAR_GREEN = 0x00A86B;
const COLOR_TOPGEAR_DARK = 0x0B0F0C;
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

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
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
    version: 2,
    panelMessages: {},
    openShifts: {},
    entries: [],
    employees: {},
    applications: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizarDatos(data) {
  const inicial = crearDatosIniciales();
  if (!data || typeof data !== "object" || Array.isArray(data)) return inicial;

  data.version = 2;
  data.panelMessages = data.panelMessages && typeof data.panelMessages === "object" ? data.panelMessages : {};
  data.openShifts = data.openShifts && typeof data.openShifts === "object" ? data.openShifts : {};
  data.entries = Array.isArray(data.entries) ? data.entries : [];
  data.employees = data.employees && typeof data.employees === "object" ? data.employees : {};
  data.applications = data.applications && typeof data.applications === "object" ? data.applications : {};
  if (!data.createdAt) data.createdAt = new Date().toISOString();
  data.updatedAt = new Date().toISOString();
  return data;
}

function cargarDatos() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const data = crearDatosIniciales();
      guardarDatos(data, { backup: false });
      return data;
    }

    const contenido = fs.readFileSync(DATA_FILE, "utf8").trim();
    if (!contenido) return crearDatosIniciales();
    return normalizarDatos(JSON.parse(contenido));
  } catch (error) {
    console.error("No se pudo leer el archivo de datos. Se creará uno nuevo:", error.message);
    return crearDatosIniciales();
  }
}

function limpiarBackupsAntiguos() {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(name => name.startsWith("topgear-") && name.endsWith(".json"))
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
    fs.copyFileSync(DATA_FILE, path.join(BACKUP_DIR, `topgear-${sello}.json`));
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

function touchEmpleado(data, userId, displayName) {
  if (!userId) return;
  const anterior = data.employees[userId] || {};
  data.employees[userId] = {
    userId,
    displayName: displayName || anterior.displayName || `Usuario ${userId}`,
    firstSeenAt: anterior.firstSeenAt || new Date().toISOString(),
    lastSeenAt: new Date().toISOString()
  };
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
    let displayName = data.employees[id]?.displayName || `Usuario ${id}`;
    try {
      const member = await interaction.guild?.members.fetch(id);
      if (member?.displayName) displayName = member.displayName;
    } catch {
      // No pasa nada: puede no estar cacheado o no estar en el servidor.
    }
    touchEmpleado(data, id, displayName);
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
      lineas.push(`🟢 ${formatDate(inicio)} ${formatTime(inicio)} → ahora · ${minutosAHoras(minutosEntrada)}`);
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
  const displayName = empleado?.displayName || `Usuario ${userId}`;
  const total = calcularMinutosEmpleado(data, userId, range);
  const detalle = total.lineas.length
    ? total.lineas.slice(-18).join("\n")
    : "No hay fichajes en este periodo.";

  return new EmbedBuilder()
    .setColor(COLOR_TOPGEAR_GREEN)
    .setTitle(title)
    .setDescription(`**Empleado:** ${displayName}\n**Periodo:** ${etiquetaRango(range)}\n**Total:** ${minutosAHoras(total.minutos)}${total.abiertos ? "\n🟢 Tiene un fichaje abierto." : ""}`)
    .addFields(
      { name: "Fichajes", value: String(total.fichajes), inline: true },
      { name: "Ajustes", value: minutosAHoras(total.minutosAjuste), inline: true },
      { name: "Detalle", value: limitarTexto(detalle, 1000), inline: false }
    )
    .setTimestamp();
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
      const aviso = item.abiertos ? " 🟢" : "";
      const ajuste = item.minutosAjuste ? ` · ajustes ${minutosAHoras(item.minutosAjuste)}` : "";
      return `• **${item.displayName}** — ${minutosAHoras(item.minutos)}${ajuste}${aviso}`;
    }).join("\n")
    : "No hay fichajes en este periodo.";

  const totalGeneral = resultados.reduce((acc, item) => acc + item.minutos, 0);

  return new EmbedBuilder()
    .setColor(COLOR_TOPGEAR_GREEN)
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
    .setColor(COLOR_TOPGEAR_GREEN)
    .setTitle("🟢⚫ 🕒 Fichajes Top Gear")
    .setDescription("Ficha tu entrada y salida. También puedes consultar tus horas por semana.")
    .setFooter({ text: "Top Gear · Control de horas" })
    .setTimestamp();
}

function crearBotonesFichajes() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:entrada`).setLabel("🟢 Entrada").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:salida`).setLabel("🔴 Salida").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:mishoras`).setLabel("⏱️ Mis horas").setStyle(ButtonStyle.Primary)
    )
  ];
}

function crearOpcionesMisHoras() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:mishoras:esta`).setLabel("🟢 Esta semana").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:mishoras:pasada`).setLabel("🔵 Semana pasada").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:ficha:mishoras:rango`).setLabel("⚫ Elegir fechas").setStyle(ButtonStyle.Secondary)
    )
  ];
}

function crearEmbedPagos() {
  return new EmbedBuilder()
    .setColor(COLOR_TOPGEAR_GREEN)
    .setTitle("🟢⚫ Top Gear | Pagos")
    .setDescription("Panel para consultar horas de empleados y modificar horas fichadas cuando haga falta.\n\nOpciones incluidas: todos los empleados, empleado concreto, esta semana, semana pasada y rango personalizado.")
    .setTimestamp();
}

function crearBotonesPagos() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:consultar`).setLabel("🟢 Consultar empleado").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:modificar`).setLabel("🛠️ Modificar horas").setStyle(ButtonStyle.Danger)
    )
  ];
}

function empleadosParaSelector(data) {
  return obtenerIdsEmpleados(data)
    .map(userId => ({
      userId,
      displayName: data.employees?.[userId]?.displayName || `Usuario ${userId}`
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "es"));
}

function crearSelectoresEmpleados(data, modo, placeholderBase) {
  const empleados = empleadosParaSelector(data).slice(0, 100);
  const rows = [];
  for (let i = 0; i < empleados.length; i += 25) {
    const chunk = empleados.slice(i, i + 25);
    const parte = Math.floor(i / 25) + 1;
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PREFIX}:pagos:selectempleado:${modo}:${parte}`)
          .setPlaceholder(empleados.length > 25 ? `${placeholderBase} · parte ${parte}` : placeholderBase)
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(chunk.map(emp => ({
            label: emp.displayName.slice(0, 100),
            value: emp.userId,
            description: `ID ${emp.userId}`.slice(0, 100)
          })))
      )
    );
  }
  return rows;
}

function crearOpcionesConsultaPagos(data) {
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:todos:esta`).setLabel("🟢 Todos · esta semana").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:todos:pasada`).setLabel("🔵 Todos · semana pasada").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:todos:rango`).setLabel("⚫ Todos · rango").setStyle(ButtonStyle.Secondary)
    )
  ];

  rows.push(...crearSelectoresEmpleados(data, "consultar", "Selecciona empleado"));
  return rows.slice(0, 5);
}

function crearSelectorModificarHoras(data) {
  return crearSelectoresEmpleados(data, "modificar", "Selecciona empleado para modificar horas").slice(0, 5);
}

function crearOpcionesRangoEmpleado(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:emp:${userId}:esta`).setLabel("🟢 Esta semana").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:emp:${userId}:pasada`).setLabel("🔵 Semana pasada").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`${PREFIX}:pagos:emp:${userId}:rango`).setLabel("⚫ Elegir fechas").setStyle(ButtonStyle.Secondary)
    )
  ];
}

function crearEmbedCalculadora() {
  return new EmbedBuilder()
    .setColor(COLOR_TOPGEAR_GREEN)
    .setTitle("🟢⚫ Top Gear | Calculadora")
    .setDescription("Abre la calculadora para calcular mejoras, reparaciones y descuentos.")
    .setTimestamp();
}

function crearBotonesCalculadora() {
  return [
    new ActionRowBuilder().addComponents(
      // Discord a veces rechaza algunos unicode en setEmoji().
      // Por eso el emote va dentro del texto del botón.
      new ButtonBuilder().setCustomId(`${PREFIX}:calc:abrir`).setLabel("🟢 🧮 Calculadora").setStyle(ButtonStyle.Success)
    )
  ];
}

function crearEmbedPostulantes() {
  return new EmbedBuilder()
    .setColor(COLOR_TOPGEAR_GREEN)
    .setTitle("🟢⚫ 🏁 Postulaciones Top Gear")
    .setDescription(`¿Quieres unirte al taller?\n\nPulsa el botón de abajo y completa tu solicitud.\n\n🔧 La postulación será revisada por el equipo encargado.`)
    .setFooter({ text: "Top Gear · Sistema de postulaciones" })
    .setTimestamp();
}

function crearBotonesPostulantes() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}:postular:abrir`).setLabel("🟢 Crear postulación").setStyle(ButtonStyle.Success)
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
    .setTitle("Postulación Top Gear")
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

function crearVistaCalculadora(userId) {
  const items = config.CALCULATOR_ITEMS.slice(0, 25);
  let session = calcSessions.get(userId);
  if (!session) {
    session = { selected: new Set(), discount: 0 };
    calcSessions.set(userId, session);
  }

  const seleccionados = items.filter(item => session.selected.has(item.id));
  const subtotal = seleccionados.reduce((acc, item) => acc + item.price, 0);
  const total = Math.round(subtotal * (1 - (session.discount || 0) / 100));

  const detalle = seleccionados.length
    ? seleccionados.map(item => `• ${item.label}: **${formatearDinero(item.price)}**`).join("\n")
    : "No hay servicios seleccionados.";

  const embed = new EmbedBuilder()
    .setColor(COLOR_TOPGEAR_GREEN)
    .setTitle("🟢⚫ 🧮 Calculadora Top Gear")
    .setDescription(limitarTexto(detalle, 1600))
    .addFields(
      { name: "Subtotal", value: `**${formatearDinero(subtotal)}**`, inline: true },
      { name: "Descuento", value: `**${session.discount || 0}%**`, inline: true },
      { name: "Total", value: `**${formatearDinero(total)}**`, inline: true }
    )
    .setFooter({ text: "Selecciona servicios y aplica descuento cuando haga falta" })
    .setTimestamp();

  const select = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}:calc:items`)
      .setPlaceholder("Añadir/quitar servicios")
      .setMinValues(0)
      .setMaxValues(Math.max(1, items.length))
      .addOptions(items.map(item => ({
        label: item.label.slice(0, 70),
        description: formatearDinero(item.price).slice(0, 95),
        value: item.id,
        default: session.selected.has(item.id)
      })))
  );

  const descuentos = (config.CALCULATOR_DISCOUNTS.length ? config.CALCULATOR_DISCOUNTS : [0, 5, 10, 15]).slice(0, 4);
  const rowDescuentos = new ActionRowBuilder().addComponents(
    ...descuentos.map(discount =>
      new ButtonBuilder()
        .setCustomId(`${PREFIX}:calc:descuento:${discount}`)
        .setLabel(`${discount}%`)
        .setStyle(session.discount === discount ? ButtonStyle.Success : ButtonStyle.Secondary)
    ),
    new ButtonBuilder().setCustomId(`${PREFIX}:calc:limpiar`).setLabel("🔴 Limpiar").setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [select, rowDescuentos] };
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
  touchEmpleado(data, userId, displayName);

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
  await enviarLog(`🟢 **Entrada** · ${displayName} (<@${userId}>) · ${formatDateTime(new Date())}`);
  return responderOk(interaction, `Entrada registrada a las **${formatTime(new Date())}**.`);
}

async function manejarSalida(interaction) {
  if (!puedeFichar(interaction)) return sinPermiso(interaction);

  const data = cargarDatos();
  const userId = interaction.user.id;
  const displayName = nombreMiembro(interaction);
  touchEmpleado(data, userId, displayName);

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

  await enviarLog(`🔴 **Salida** · ${displayName} (<@${userId}>) · ${formatDateTime(fin)} · Turno: **${minutosAHoras(minutos)}**`);
  return responderOk(interaction, `Salida registrada. Turno total: **${minutosAHoras(minutos)}**.`);
}

async function manejarMisHoras(interaction) {
  const data = cargarDatos();
  const userId = interaction.user.id;
  touchEmpleado(data, userId, nombreMiembro(interaction));
  guardarDatos(data);

  return interaction.reply(respuestaPrivada({
    content: "Elige qué horas quieres consultar:",
    components: crearOpcionesMisHoras()
  }));
}

async function consultarMisHoras(interaction, range) {
  const data = cargarDatos();
  const userId = interaction.user.id;
  touchEmpleado(data, userId, nombreMiembro(interaction));
  guardarDatos(data);

  return interaction.reply(respuestaPrivada({
    embeds: [embedEmpleado(data, userId, range, `Mis horas · ${range.label}`)]
  }));
}

async function consultarTodos(interaction, range) {
  const data = cargarDatos();
  return interaction.reply(respuestaPrivada({ embeds: [embedTodos(data, range, `Todos los empleados · ${range.label}`)] }));
}

async function consultarEmpleado(interaction, empleadoTexto, range) {
  const data = cargarDatos();
  const empleado = await resolverEmpleado(interaction, empleadoTexto, data);
  if (empleado.error) return responderError(interaction, empleado.error);
  guardarDatos(data);
  return interaction.reply(respuestaPrivada({ embeds: [embedEmpleado(data, empleado.userId, range, `Empleado · ${range.label}`)] }));
}

async function modificarHorasEmpleado(interaction, empleadoTexto, desde, hasta, horasTexto, motivo = "") {
  if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);

  const range = rangoDesdeHasta(desde, hasta);
  if (!range) return responderError(interaction, "Rango no válido. Usa fechas con formato YYYY-MM-DD y asegúrate de que `hasta` no sea anterior a `desde`." );

  const minutosDeseados = parseHoras(horasTexto);
  if (minutosDeseados === null || minutosDeseados < 0) return responderError(interaction, "Horas no válidas. Usa 8, 7.5, 7,5 o 07:30.");

  const data = cargarDatos();
  const empleado = await resolverEmpleado(interaction, empleadoTexto, data);
  if (empleado.error) return responderError(interaction, empleado.error);

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
      ? "✅ No hizo falta crear ajuste: el total ya coincidía."
      : `✅ Horas modificadas. Ajuste aplicado: **${minutosAHoras(delta)}**.`,
    embeds: [embedEmpleado(data, empleado.userId, range, "Resultado tras modificar horas")]
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
  touchEmpleado(data, userId, displayName);
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
  calcSessions.set(interaction.user.id, { selected: new Set(), discount: 0 });
  return interaction.reply(respuestaPrivada(crearVistaCalculadora(interaction.user.id)));
}

async function manejarSelectorCalculadora(interaction) {
  const session = calcSessions.get(interaction.user.id) || { selected: new Set(), discount: 0 };
  session.selected = new Set(interaction.values || []);
  calcSessions.set(interaction.user.id, session);
  return interaction.update(crearVistaCalculadora(interaction.user.id));
}

async function manejarBotonCalculadora(interaction, id) {
  const session = calcSessions.get(interaction.user.id) || { selected: new Set(), discount: 0 };
  if (id === `${PREFIX}:calc:limpiar`) {
    session.selected = new Set();
    session.discount = 0;
  } else if (id.startsWith(`${PREFIX}:calc:descuento:`)) {
    const value = Number(id.replace(`${PREFIX}:calc:descuento:`, ""));
    session.discount = Number.isFinite(value) ? value : 0;
  }
  calcSessions.set(interaction.user.id, session);
  return interaction.update(crearVistaCalculadora(interaction.user.id));
}

function crearEmbedPostulacion(app) {
  return new EmbedBuilder()
    .setColor(COLOR_TOPGEAR_GREEN)
    .setTitle("🟢⚫ 🏁 Nueva postulación Top Gear")
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
      new ButtonBuilder().setCustomId(`${PREFIX}:app:aceptar:${appId}`).setLabel("🟢 Aceptar").setStyle(ButtonStyle.Success).setDisabled(disabled),
      new ButtonBuilder().setCustomId(`${PREFIX}:app:denegar:${appId}`).setLabel("🔴 Denegar").setStyle(ButtonStyle.Danger).setDisabled(disabled)
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
    topic: `Postulación Top Gear de ${app.displayName} · ${app.userId}`
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
    touchEmpleado(data, app.userId, app.nombreIc || app.displayName);
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
      if (config.APPLICATION_CHANGE_NICKNAME && app.nombreIc) {
        await member.setNickname(app.nombreIc).catch(error => {
          detalleRoles += `\n⚠️ No pude cambiar el apodo: ${error.message}`;
        });
      }
      touchEmpleado(data, app.userId, app.nombreIc || app.displayName);
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


client.once(Events.ClientReady, async () => {
  logDatos();
  logConfiguracionPaneles();
  console.log(`Bot conectado como ${client.user.tag}`);
  await registrarComandos();

  if (config.AUTO_PUBLISH_PANELS) {
    const publicados = await publicarPaneles();
    await enviarLog(`✅ Bot iniciado. Paneles publicados/actualizados: ${publicados}.`);
  } else {
    console.log("AUTO_PUBLISH_PANELS=false. No se publican paneles al iniciar. Usa /paneles para publicarlos manualmente.");
  }
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

      if (id === `${PREFIX}:pagos:consultar`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const data = cargarDatos();
        const components = crearOpcionesConsultaPagos(data);
        return interaction.reply(respuestaPrivada({
          content: empleadosParaSelector(data).length
            ? "Elige qué quieres consultar:"
            : "No hay empleados registrados todavía. Cuando alguien fiche entrada o sea aceptado, aparecerá aquí.",
          components
        }));
      }

      if (id === `${PREFIX}:pagos:modificar`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const data = cargarDatos();
        const components = crearSelectorModificarHoras(data);
        return interaction.reply(respuestaPrivada({
          content: components.length
            ? "Selecciona el empleado al que quieres modificar horas:"
            : "No hay empleados registrados todavía. Cuando alguien fiche entrada o sea aceptado, aparecerá aquí.",
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
      if (id === `${PREFIX}:calc:limpiar` || id.startsWith(`${PREFIX}:calc:descuento:`)) return manejarBotonCalculadora(interaction, id);
      if (id === `${PREFIX}:postular:abrir`) return interaction.showModal(crearModalPostulacion());

      if (id.startsWith(`${PREFIX}:app:aceptar:`)) {
        return manejarDecisionPostulacion(interaction, id.replace(`${PREFIX}:app:aceptar:`, ""), "aceptar");
      }

      if (id.startsWith(`${PREFIX}:app:denegar:`)) {
        return manejarDecisionPostulacion(interaction, id.replace(`${PREFIX}:app:denegar:`, ""), "denegar");
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
        touchEmpleado(data, userId, displayName);
        guardarDatos(data);
        return interaction.reply(respuestaPrivada({
          content: `Empleado seleccionado: <@${userId}>. Elige el periodo:`,
          components: crearOpcionesRangoEmpleado(userId)
        }));
      }

      if (interaction.customId === `${PREFIX}:pagos:select:modificar`) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const userId = interaction.values?.[0];
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        return interaction.showModal(crearModalModificarHorasEmpleado(userId));
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === `${PREFIX}:calc:items`) return manejarSelectorCalculadora(interaction);

      if (interaction.customId.startsWith(`${PREFIX}:pagos:selectempleado:consultar:`)) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const userId = interaction.values?.[0];
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        return interaction.reply(respuestaPrivada({
          content: `Empleado seleccionado: <@${userId}>. Elige el periodo:`,
          components: crearOpcionesRangoEmpleado(userId)
        }));
      }

      if (interaction.customId.startsWith(`${PREFIX}:pagos:selectempleado:modificar:`)) {
        if (!puedeGestionarPagos(interaction)) return sinPermiso(interaction);
        const userId = interaction.values?.[0];
        if (!/^\d{17,20}$/.test(userId || "")) return responderError(interaction, "Empleado no válido.");
        return interaction.showModal(crearModalModificarHorasEmpleado(userId));
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

client.login(config.TOKEN);
