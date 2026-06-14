const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
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

const STOCK_FILE_NAME = "stock.json";

function rutaUnica(rutas) {
  return [...new Set(rutas.filter(Boolean).map(ruta => path.resolve(ruta)))];
}

function existeDirectorio(ruta) {
  try {
    return fs.existsSync(ruta) && fs.statSync(ruta).isDirectory();
  } catch {
    return false;
  }
}

function elegirDirectorioPreferido() {
  if (process.env.STOCK_FILE) return path.dirname(process.env.STOCK_FILE);
  if (process.env.STOCK_DATA_DIR) return process.env.STOCK_DATA_DIR;
  if (process.env.DATA_DIR) return process.env.DATA_DIR;
  if (process.env.RAILWAY_VOLUME_MOUNT_PATH) return process.env.RAILWAY_VOLUME_MOUNT_PATH;

  // Si en Railway montas un Volume en /data, el bot guardará aquí y no se perderá en redeploys.
  if (existeDirectorio("/data")) return "/data";

  // Fallback local. En Railway sin Volume esto NO es persistente entre redeploys.
  return path.join(__dirname, "data");
}

const DATA_DIR = elegirDirectorioPreferido();
const DATA_FILE = process.env.STOCK_FILE
  ? path.resolve(process.env.STOCK_FILE)
  : path.join(DATA_DIR, STOCK_FILE_NAME);
const BACKUP_DIR = path.join(path.dirname(DATA_FILE), "backups");

function leerJsonSeguro(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    if (!fs.statSync(filePath).isFile()) return null;

    const contenido = fs.readFileSync(filePath, "utf8").trim();
    if (!contenido) return null;

    const data = JSON.parse(contenido);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;

    return data;
  } catch {
    return null;
  }
}

function puntuacionStock(data) {
  if (!data || typeof data !== "object") return -1;

  let total = 0;

  if (data.weapons && typeof data.weapons === "object") {
    for (const cantidad of Object.values(data.weapons)) {
      const numero = Number(cantidad);
      if (Number.isFinite(numero) && numero > 0) total += numero;
    }
  }

  if (data.drugs && typeof data.drugs === "object") {
    for (const estados of Object.values(data.drugs)) {
      if (!estados || typeof estados !== "object") continue;

      for (const cantidad of Object.values(estados)) {
        const numero = Number(cantidad);
        if (Number.isFinite(numero) && numero > 0) total += numero;
      }
    }
  }

  const dinero = Number(data.money || 0);
  if (Number.isFinite(dinero) && dinero > 0) total += dinero;

  if (data.panelMessageId) total += 1;
  if (data.mafiaLevel && Number(data.mafiaLevel) !== 1) total += 1;

  return total;
}

function posiblesArchivosStock() {
  return rutaUnica([
    DATA_FILE,
    "/data/stock.json",
    "/app/data/stock.json",
    "/app/stock.json",
    path.join(process.cwd(), "data", "stock.json"),
    path.join(process.cwd(), "stock.json"),
    path.join(__dirname, "data", "stock.json"),
    path.join(__dirname, "stock.json")
  ]);
}

function prepararArchivoDatos() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

  const encontrados = posiblesArchivosStock()
    .map(filePath => ({ filePath, data: leerJsonSeguro(filePath) }))
    .filter(item => item.data)
    .map(item => ({ ...item, score: puntuacionStock(item.data) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.filePath === path.resolve(DATA_FILE)) return -1;
      if (b.filePath === path.resolve(DATA_FILE)) return 1;
      return 0;
    });

  if (encontrados.length > 0) {
    const mejor = encontrados[0];

    if (mejor.filePath !== path.resolve(DATA_FILE)) {
      fs.copyFileSync(mejor.filePath, DATA_FILE);
      console.log(`Stock recuperado de ${mejor.filePath} y copiado a ${DATA_FILE}`);
    }
  }

  console.log(`Datos guardándose en: ${DATA_FILE}`);

  if (!process.env.STOCK_FILE && !process.env.STOCK_DATA_DIR && !process.env.DATA_DIR && !process.env.RAILWAY_VOLUME_MOUNT_PATH && !existeDirectorio("/data")) {
    console.warn("AVISO: no se ha detectado Volume de Railway. Si redeployas, el stock puede perderse. Monta un Volume en /data o define STOCK_DATA_DIR.");
  }
}

prepararArchivoDatos();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

function respuestaPrivada(opciones) {
  return {
    ...opciones,
    flags: MessageFlags.Ephemeral
  };
}

function crearDatosIniciales() {
  const weapons = {};
  const drugs = {};

  for (const weapon of config.WEAPONS) {
    weapons[weapon] = 0;
  }

  for (const drug of config.DRUGS) {
    drugs[drug.id] = {};

    for (const state of config.DRUG_STATES) {
      drugs[drug.id][state.id] = 0;
    }
  }

  return {
    panelMessageId: null,
    mafiaLevel: 1,
    money: 0,
    weapons,
    drugs
  };
}

function cargarDatos() {
  if (!fs.existsSync(DATA_FILE)) {
    const data = crearDatosIniciales();
    guardarDatos(data);
    return data;
  }

  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

    if (!data.weapons) data.weapons = {};
    if (!data.drugs) data.drugs = {};
    if (typeof data.money !== "number") data.money = 0;
    if (!("panelMessageId" in data)) data.panelMessageId = null;

    if (![1, 2, 3].includes(Number(data.mafiaLevel))) {
      data.mafiaLevel = 1;
    } else {
      data.mafiaLevel = Number(data.mafiaLevel);
    }

    for (const weapon of config.WEAPONS) {
      if (typeof data.weapons[weapon] !== "number") {
        data.weapons[weapon] = 0;
      }
    }

    for (const drug of config.DRUGS) {
      if (!data.drugs[drug.id] || typeof data.drugs[drug.id] !== "object") {
        data.drugs[drug.id] = {};
      }

      for (const state of config.DRUG_STATES) {
        if (typeof data.drugs[drug.id][state.id] !== "number") {
          data.drugs[drug.id][state.id] = 0;
        }
      }
    }

    return data;
  } catch (error) {
    console.error("Error leyendo stock.json, se crea uno nuevo:", error);
    const data = crearDatosIniciales();
    guardarDatos(data);
    return data;
  }
}

function fechaBackup() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function limpiarBackupsAntiguos(maxBackups = 30) {
  try {
    if (!fs.existsSync(BACKUP_DIR)) return;

    const backups = fs.readdirSync(BACKUP_DIR)
      .filter(name => name.startsWith("stock-") && name.endsWith(".json"))
      .map(name => ({
        name,
        filePath: path.join(BACKUP_DIR, name),
        time: fs.statSync(path.join(BACKUP_DIR, name)).mtimeMs
      }))
      .sort((a, b) => b.time - a.time);

    for (const backup of backups.slice(maxBackups)) {
      fs.unlinkSync(backup.filePath);
    }
  } catch (error) {
    console.warn("No se pudieron limpiar backups antiguos:", error.message);
  }
}

function hacerBackupSiExiste() {
  try {
    if (!fs.existsSync(DATA_FILE)) return;

    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const backupFile = path.join(BACKUP_DIR, `stock-${fechaBackup()}.json`);
    fs.copyFileSync(DATA_FILE, backupFile);
    limpiarBackupsAntiguos();
  } catch (error) {
    console.warn("No se pudo crear backup del stock:", error.message);
  }
}

function guardarDatos(data) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  hacerBackupSiExiste();

  const temporal = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporal, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temporal, DATA_FILE);
}

function formatearDinero(value) {
  return `${new Intl.NumberFormat("es-ES").format(value)}$`;
}

function tieneRol(interaction, rolesPermitidos) {
  if (!interaction.member) return false;

  if (
    config.ADMIN_BYPASS &&
    interaction.member.permissions?.has(PermissionsBitField.Flags.Administrator)
  ) {
    return true;
  }

  return rolesPermitidos.some(roleId => interaction.member.roles.cache.has(roleId));
}

function nombreUsuario(interaction) {
  if (interaction.user?.id) return `<@${interaction.user.id}>`;
  return "Alguien";
}

async function enviarLogSimple(texto) {
  const logChannelId = process.env.LOG_CHANNEL_ID || config.LOG_CHANNEL_ID;

  if (!logChannelId) {
    console.warn("No se ha configurado LOG_CHANNEL_ID en config.js ni en Railway.");
    return false;
  }

  let channel;

  try {
    channel = await client.channels.fetch(logChannelId);
  } catch (error) {
    console.error(`No pude encontrar el canal de logs ${logChannelId}:`, error.message);
    return false;
  }

  if (!channel || !channel.isTextBased()) {
    console.error(`El canal de logs ${logChannelId} no es un canal de texto válido.`);
    return false;
  }

  try {
    await channel.send(texto);
    return true;
  } catch (error) {
    console.error(`No pude mandar el log al canal ${logChannelId}. Revisa permisos del bot en ese canal:`, error.message);
    return false;
  }
}

function armasPermitidasPorNivel() {
  const data = cargarDatos();
  const nivel = data.mafiaLevel || 1;
  return config.MAFIA_LEVEL_WEAPONS[nivel] || config.MAFIA_LEVEL_WEAPONS[1];
}

function esRolSuperior(interaction) {
  return tieneRol(interaction, config.ADD_ANY_WEAPON_ROLES);
}

function armasVisiblesParaUsuario(interaction) {
  if (esRolSuperior(interaction)) {
    return config.WEAPONS;
  }

  return armasPermitidasPorNivel();
}

function armasSeleccionablesParaUsuario(interaction, accion) {
  // Los roles principales pueden AÑADIR y QUITAR cualquier arma del listado.
  if (
    (accion === "anadir" || accion === "quitar") &&
    tieneRol(interaction, config.ADD_ANY_WEAPON_ROLES)
  ) {
    return config.WEAPONS;
  }

  // El resto solo puede trabajar con las armas activas por nivel.
  return armasPermitidasPorNivel();
}

function obtenerDroga(drugId) {
  return config.DRUGS.find(drug => drug.id === drugId) || null;
}

function obtenerEstadoDroga(stateId) {
  return config.DRUG_STATES.find(state => state.id === stateId) || null;
}

function nombreDroga(drugId) {
  return obtenerDroga(drugId)?.label || drugId;
}

function nombreEstadoDroga(stateId) {
  return obtenerEstadoDroga(stateId)?.label || stateId;
}

function nombreDrogaCompleto(drugId, stateId) {
  return `${nombreDroga(drugId)} ${nombreEstadoDroga(stateId).toLowerCase()}`;
}

function textoStockDrogas(data) {
  const lineas = [];

  for (const drug of config.DRUGS) {
    const partes = config.DRUG_STATES.map(state => {
      const cantidad = data.drugs?.[drug.id]?.[state.id] || 0;
      return `${state.label}: ${cantidad}`;
    });

    lineas.push(`**${drug.label}:** ${partes.join(" | ")}`);
  }

  return lineas.join("\n");
}

// Panel público: no enseña stock, no enseña dinero y no enseña footer del candado.
function crearEmbedPanel() {
  const data = cargarDatos();
  const armasPermitidas = armasPermitidasPorNivel();

  return new EmbedBuilder()
    .setColor(0xC01718)
    .setTitle("Control de almacén")
    .setDescription("Usa los botones para gestionar el almacén.")
    .addFields(
      {
        name: "⭐ Nivel de mafia",
        value: `**Nivel ${data.mafiaLevel || 1}**`,
        inline: true
      },
      {
        name: "✅ Armas activas por nivel",
        value: armasPermitidas.join(", ") || "Ninguna",
        inline: false
      },
      {
        name: "🧪 Droga",
        value: "Coca, heroína y meta. Cada una puede estar procesada o sin procesar.",
        inline: false
      }
    )
    .setTimestamp();
}

// Consulta privada del stock: cada usuario solo ve las armas que le corresponden por rol.
function crearEmbedStockPrivado(interaction) {
  const data = cargarDatos();
  const armasVisibles = armasVisiblesParaUsuario(interaction);

  const armasTexto = armasVisibles
    .map(weapon => `**${weapon}:** ${data.weapons[weapon] || 0}`)
    .join("\n");

  return new EmbedBuilder()
    .setColor(0xC01718)
    .setTitle("Stock actual")
    .addFields(
      {
        name: "⭐ Nivel de mafia",
        value: `**Nivel ${data.mafiaLevel || 1}**`,
        inline: true
      },
      {
        name: "Armas",
        value: armasTexto || "No hay armas para mostrar.",
        inline: false
      },
      {
        name: "Droga",
        value: drogasTexto || "No hay droga para mostrar.",
        inline: false
      }
    )
    .setTimestamp();
}

function crearBotonesPanel() {
  const filaArmas = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("arma_anadir")
      .setLabel("Añadir arma")
      .setEmoji("➕")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("arma_quitar")
      .setLabel("Quitar arma")
      .setEmoji("➖")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("stock_ver")
      .setLabel("Ver stock")
      .setEmoji("📦")
      .setStyle(ButtonStyle.Secondary)
  );

  const filaDroga = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("droga_anadir")
      .setLabel("Añadir droga")
      .setEmoji("🧪")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("droga_quitar")
      .setLabel("Quitar droga")
      .setEmoji("🧫")
      .setStyle(ButtonStyle.Danger)
  );

  const filaDinero = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("dinero_meter")
      .setLabel("Meter dinero")
      .setEmoji("💰")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("dinero_sacar")
      .setLabel("Sacar dinero")
      .setEmoji("💸")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("dinero_ver")
      .setLabel("Ver dinero")
      .setEmoji("👀")
      .setStyle(ButtonStyle.Secondary)
  );

  return [filaArmas, filaDroga, filaDinero];
}

function esMensajePanelDelBot(message) {
  if (!message || message.author?.id !== client.user.id) return false;

  const tieneBotonesPanel = message.components?.some(row =>
    row.components?.some(component =>
      [
        "arma_anadir",
        "arma_quitar",
        "stock_ver",
        "droga_anadir",
        "droga_quitar",
        "dinero_meter",
        "dinero_sacar",
        "dinero_ver"
      ].includes(component.customId)
    )
  );

  const tituloEmbed = message.embeds?.[0]?.title || "";
  const tituloValido =
    tituloEmbed.includes("Control de almacén") ||
    tituloEmbed.includes("Stock de armas") ||
    tituloEmbed.includes("Stock actual");

  return Boolean(tieneBotonesPanel || tituloValido);
}

async function buscarMensajePanelExistente(channel, data) {
  if (data.panelMessageId) {
    const mensajeGuardado = await channel.messages.fetch(data.panelMessageId).catch(() => null);

    if (mensajeGuardado && esMensajePanelDelBot(mensajeGuardado)) {
      return mensajeGuardado;
    }
  }

  const mensajes = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!mensajes) return null;

  const paneles = mensajes
    .filter(message => esMensajePanelDelBot(message))
    .sort((a, b) => b.createdTimestamp - a.createdTimestamp);

  return paneles.first() || null;
}

async function borrarPanelesDuplicados(channel, panelCorrectoId) {
  const mensajes = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!mensajes) return;

  const duplicados = mensajes.filter(
    message => esMensajePanelDelBot(message) && message.id !== panelCorrectoId
  );

  for (const [, message] of duplicados) {
    await message.delete().catch(() => {});
  }
}

async function actualizarPanel() {
  const data = cargarDatos();
  const channel = await client.channels.fetch(config.CHANNEL_ID).catch(() => null);

  if (!channel || !channel.isTextBased()) {
    console.log("No se ha encontrado el canal configurado.");
    return;
  }

  const payload = {
    embeds: [crearEmbedPanel()],
    components: crearBotonesPanel()
  };

  const panelExistente = await buscarMensajePanelExistente(channel, data);

  if (panelExistente) {
    await panelExistente.edit(payload);
    data.panelMessageId = panelExistente.id;
    guardarDatos(data);
    await borrarPanelesDuplicados(channel, panelExistente.id);
    console.log(`Panel actualizado en el canal ${config.CHANNEL_ID}. Mensaje: ${panelExistente.id}`);
    return;
  }

  const nuevoMensaje = await channel.send(payload);
  data.panelMessageId = nuevoMensaje.id;
  guardarDatos(data);
  await borrarPanelesDuplicados(channel, nuevoMensaje.id);
  console.log(`Panel creado en el canal ${config.CHANNEL_ID}. Mensaje: ${nuevoMensaje.id}`);
}

async function registrarComandos() {
  const comandos = [
    new SlashCommandBuilder()
      .setName("nivelmafia")
      .setDescription("Cambia el nivel de la mafia y activa las armas permitidas.")
      .addIntegerOption(option =>
        option
          .setName("nivel")
          .setDescription("Nivel de mafia: 1, 2 o 3")
          .setRequired(true)
          .addChoices(
            { name: "Nivel 1", value: 1 },
            { name: "Nivel 2", value: 2 },
            { name: "Nivel 3", value: 3 }
          )
      )
      .toJSON()
  ];

  await client.application.commands.set(comandos);
  console.log("Comando /nivelmafia registrado.");
}

function crearSelectorArma(interaction, accion) {
  const armasSeleccionables = armasSeleccionablesParaUsuario(interaction, accion);
  const texto =
    accion === "anadir"
      ? "Selecciona el arma que quieres añadir"
      : "Selecciona el arma que quieres quitar";

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`selector_arma_${accion}`)
      .setPlaceholder(texto)
      .addOptions(
        armasSeleccionables.map(weapon => ({
          label: weapon,
          value: weapon
        }))
      )
  );
}

function crearModalCantidadArma(accion, weapon) {
  const titulo = accion === "anadir" ? `Añadir ${weapon}` : `Quitar ${weapon}`;

  return new ModalBuilder()
    .setCustomId(`modal_arma_${accion}|${weapon}`)
    .setTitle(titulo)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("cantidad")
          .setLabel("Cantidad de armas")
          .setPlaceholder("Ejemplo: 5")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function crearSelectorDroga(accion) {
  const texto =
    accion === "anadir"
      ? "Selecciona la droga que quieres añadir"
      : "Selecciona la droga que quieres quitar";

  const opciones = [];

  for (const drug of config.DRUGS) {
    for (const state of config.DRUG_STATES) {
      opciones.push({
        label: `${drug.label} ${state.label.toLowerCase()}`,
        value: `${drug.id}|${state.id}`
      });
    }
  }

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`selector_droga_${accion}`)
      .setPlaceholder(texto)
      .addOptions(opciones)
  );
}

function crearModalCantidadDroga(accion, drugId, stateId) {
  const nombre = nombreDrogaCompleto(drugId, stateId);
  const titulo = accion === "anadir" ? `Añadir ${nombre}` : `Quitar ${nombre}`;

  return new ModalBuilder()
    .setCustomId(`modal_droga_${accion}|${drugId}|${stateId}`)
    .setTitle(titulo)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("cantidad")
          .setLabel("Cantidad de droga")
          .setPlaceholder("Ejemplo: 50")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function crearModalDinero(accion) {
  const titulo = accion === "meter" ? "Meter dinero" : "Sacar dinero";

  return new ModalBuilder()
    .setCustomId(`modal_dinero_${accion}`)
    .setTitle(titulo)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("cantidad")
          .setLabel("Cantidad de dinero")
          .setPlaceholder("Ejemplo: 25000")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
      )
    );
}

function leerCantidad(texto) {
  const limpio = String(texto)
    .trim()
    .replaceAll(".", "")
    .replaceAll(",", "");

  if (!/^\d+$/.test(limpio)) return null;

  const numero = Number(limpio);
  if (!Number.isSafeInteger(numero) || numero <= 0) return null;

  return numero;
}

async function sinPermiso(interaction) {
  return interaction.reply(
    respuestaPrivada({
      content: "❌ No tienes permisos para usar esta opción."
    })
  );
}

async function responderError(interaction, texto) {
  return interaction.reply(
    respuestaPrivada({
      content: `❌ ${texto}`
    })
  );
}

async function responderOk(interaction, texto) {
  return interaction.reply(
    respuestaPrivada({
      content: `✅ ${texto}`
    })
  );
}

client.once(Events.ClientReady, async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  await registrarComandos();
  await actualizarPanel();
  await enviarLogSimple("✅ Bot iniciado y panel actualizado.");
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === "nivelmafia") {
        if (!tieneRol(interaction, config.SET_MAFIA_LEVEL_ROLES)) {
          return sinPermiso(interaction);
        }

        const nivel = interaction.options.getInteger("nivel");

        if (![1, 2, 3].includes(nivel)) {
          return responderError(interaction, "El nivel debe ser 1, 2 o 3.");
        }

        const data = cargarDatos();
        data.mafiaLevel = nivel;
        guardarDatos(data);
        await actualizarPanel();

        await enviarLogSimple(`⭐ ${nombreUsuario(interaction)} cambió el nivel de mafia a nivel ${nivel}.`);

        const armas = config.MAFIA_LEVEL_WEAPONS[nivel].join(", ");

        return interaction.reply(
          respuestaPrivada({
            content: `✅ Nivel de mafia cambiado a **nivel ${nivel}**.\nArmas activas: **${armas}**.`
          })
        );
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === "arma_anadir") {
        if (!tieneRol(interaction, config.ADD_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        return interaction.reply(
          respuestaPrivada({
            content: "Elige el arma que quieres añadir.\nDespués te pedirá la cantidad.",
            components: [crearSelectorArma(interaction, "anadir")]
          })
        );
      }

      if (interaction.customId === "arma_quitar") {
        if (!tieneRol(interaction, config.REMOVE_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        return interaction.reply(
          respuestaPrivada({
            content: "Elige el arma que quieres quitar.\nDespués te pedirá la cantidad.",
            components: [crearSelectorArma(interaction, "quitar")]
          })
        );
      }

      if (interaction.customId === "stock_ver") {
        return interaction.reply(
          respuestaPrivada({
            embeds: [crearEmbedStockPrivado(interaction)]
          })
        );
      }

      if (interaction.customId === "droga_anadir") {
        if (!tieneRol(interaction, config.ADD_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        return interaction.reply(
          respuestaPrivada({
            content: "Elige la droga que quieres añadir.\nDespués te pedirá la cantidad.",
            components: [crearSelectorDroga("anadir")]
          })
        );
      }

      if (interaction.customId === "droga_quitar") {
        if (!tieneRol(interaction, config.REMOVE_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        return interaction.reply(
          respuestaPrivada({
            content: "Elige la droga que quieres quitar.\nDespués te pedirá la cantidad.",
            components: [crearSelectorDroga("quitar")]
          })
        );
      }

      if (interaction.customId === "dinero_meter") {
        if (!tieneRol(interaction, config.ADD_MONEY_ROLES)) {
          return sinPermiso(interaction);
        }

        return interaction.showModal(crearModalDinero("meter"));
      }

      if (interaction.customId === "dinero_sacar") {
        if (!tieneRol(interaction, config.REMOVE_MONEY_ROLES)) {
          return sinPermiso(interaction);
        }

        return interaction.showModal(crearModalDinero("sacar"));
      }

      if (interaction.customId === "dinero_ver") {
        const data = cargarDatos();

        return interaction.reply(
          respuestaPrivada({
            content: `Dinero actual: **${formatearDinero(data.money || 0)}**`
          })
        );
      }
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("selector_arma_")) {
        const accion = interaction.customId.replace("selector_arma_", "");
        const weapon = interaction.values[0];
        const armasSeleccionables = armasSeleccionablesParaUsuario(interaction, accion);

        if (!config.WEAPONS.includes(weapon)) {
          return responderError(interaction, "Esa arma no existe en la configuración.");
        }

        if (!armasSeleccionables.includes(weapon)) {
          return responderError(interaction, "Esa arma no está permitida para tu rol o para el nivel actual.");
        }

        if (accion === "anadir" && !tieneRol(interaction, config.ADD_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        if (accion === "quitar" && !tieneRol(interaction, config.REMOVE_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        return interaction.showModal(crearModalCantidadArma(accion, weapon));
      }

      if (interaction.customId.startsWith("selector_droga_")) {
        const accion = interaction.customId.replace("selector_droga_", "");
        const [drugId, stateId] = interaction.values[0].split("|");

        if (!obtenerDroga(drugId) || !obtenerEstadoDroga(stateId)) {
          return responderError(interaction, "Esa droga no existe en la configuración.");
        }

        if (accion === "anadir" && !tieneRol(interaction, config.ADD_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        if (accion === "quitar" && !tieneRol(interaction, config.REMOVE_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        return interaction.showModal(crearModalCantidadDroga(accion, drugId, stateId));
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("modal_arma_")) {
        const [parteAccion, weapon] = interaction.customId.split("|");
        const accion = parteAccion.replace("modal_arma_", "");
        const cantidad = leerCantidad(interaction.fields.getTextInputValue("cantidad"));
        const armasSeleccionables = armasSeleccionablesParaUsuario(interaction, accion);

        if (!cantidad) {
          return responderError(interaction, "La cantidad debe ser un número entero mayor que 0.");
        }

        if (!config.WEAPONS.includes(weapon)) {
          return responderError(interaction, "Esa arma no existe en la configuración.");
        }

        if (!armasSeleccionables.includes(weapon)) {
          return responderError(interaction, "Esa arma no está permitida para tu rol o para el nivel actual.");
        }

        if (accion === "anadir" && !tieneRol(interaction, config.ADD_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        if (accion === "quitar" && !tieneRol(interaction, config.REMOVE_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        const data = cargarDatos();
        const stockActual = data.weapons[weapon] || 0;

        if (accion === "anadir") {
          data.weapons[weapon] = stockActual + cantidad;
          guardarDatos(data);
          await actualizarPanel();
          await enviarLogSimple(`➕ ${nombreUsuario(interaction)} añadió ${cantidad} ${weapon}. Stock ahora: ${data.weapons[weapon]}.`);

          return responderOk(interaction, `Has añadido **${cantidad} ${weapon}**.`);
        }

        if (accion === "quitar") {
          if (stockActual < cantidad) {
            return responderError(
              interaction,
              `No hay suficiente stock de **${weapon}**.\nStock actual: **${stockActual}**.`
            );
          }

          data.weapons[weapon] = stockActual - cantidad;
          guardarDatos(data);
          await actualizarPanel();
          await enviarLogSimple(`➖ ${nombreUsuario(interaction)} quitó ${cantidad} ${weapon}. Stock ahora: ${data.weapons[weapon]}.`);

          return responderOk(interaction, `Has quitado **${cantidad} ${weapon}**.`);
        }
      }

      if (interaction.customId.startsWith("modal_droga_")) {
        const [parteAccion, drugId, stateId] = interaction.customId.split("|");
        const accion = parteAccion.replace("modal_droga_", "");
        const cantidad = leerCantidad(interaction.fields.getTextInputValue("cantidad"));

        if (!cantidad) {
          return responderError(interaction, "La cantidad debe ser un número entero mayor que 0.");
        }

        if (!obtenerDroga(drugId) || !obtenerEstadoDroga(stateId)) {
          return responderError(interaction, "Esa droga no existe en la configuración.");
        }

        if (accion === "anadir" && !tieneRol(interaction, config.ADD_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        if (accion === "quitar" && !tieneRol(interaction, config.REMOVE_WEAPON_ROLES)) {
          return sinPermiso(interaction);
        }

        const data = cargarDatos();
        const stockActual = data.drugs[drugId][stateId] || 0;
        const nombre = nombreDrogaCompleto(drugId, stateId);

        if (accion === "anadir") {
          data.drugs[drugId][stateId] = stockActual + cantidad;
          guardarDatos(data);
          await actualizarPanel();
          await enviarLogSimple(`🧪 ${nombreUsuario(interaction)} añadió ${cantidad} ${nombre}. Stock ahora: ${data.drugs[drugId][stateId]}.`);

          return responderOk(interaction, `Has añadido **${cantidad} ${nombre}**.`);
        }

        if (accion === "quitar") {
          if (stockActual < cantidad) {
            return responderError(
              interaction,
              `No hay suficiente stock de **${nombre}**.\nStock actual: **${stockActual}**.`
            );
          }

          data.drugs[drugId][stateId] = stockActual - cantidad;
          guardarDatos(data);
          await actualizarPanel();
          await enviarLogSimple(`🧫 ${nombreUsuario(interaction)} quitó ${cantidad} ${nombre}. Stock ahora: ${data.drugs[drugId][stateId]}.`);

          return responderOk(interaction, `Has quitado **${cantidad} ${nombre}**.`);
        }
      }

      if (interaction.customId.startsWith("modal_dinero_")) {
        const accion = interaction.customId.replace("modal_dinero_", "");
        const cantidad = leerCantidad(interaction.fields.getTextInputValue("cantidad"));

        if (!cantidad) {
          return responderError(interaction, "La cantidad debe ser un número entero mayor que 0.");
        }

        if (accion === "meter" && !tieneRol(interaction, config.ADD_MONEY_ROLES)) {
          return sinPermiso(interaction);
        }

        if (accion === "sacar" && !tieneRol(interaction, config.REMOVE_MONEY_ROLES)) {
          return sinPermiso(interaction);
        }

        const data = cargarDatos();
        const dineroActual = data.money || 0;

        if (accion === "meter") {
          data.money = dineroActual + cantidad;
          guardarDatos(data);
          await actualizarPanel();
          await enviarLogSimple(`💰 ${nombreUsuario(interaction)} metió ${formatearDinero(cantidad)}. Dinero ahora: ${formatearDinero(data.money)}.`);

          return responderOk(interaction, `Has metido **${formatearDinero(cantidad)}**.`);
        }

        if (accion === "sacar") {
          if (dineroActual < cantidad) {
            return responderError(
              interaction,
              `No hay suficiente dinero.\nDinero actual: **${formatearDinero(dineroActual)}**.`
            );
          }

          data.money = dineroActual - cantidad;
          guardarDatos(data);
          await actualizarPanel();
          await enviarLogSimple(`💸 ${nombreUsuario(interaction)} sacó ${formatearDinero(cantidad)}. Dinero ahora: ${formatearDinero(data.money)}.`);

          return responderOk(interaction, `Has sacado **${formatearDinero(cantidad)}**.`);
        }
      }
    }
  } catch (error) {
    console.error(error);

    const respuesta = respuestaPrivada({
      content: "❌ Ha ocurrido un error al procesar la acción."
    });

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(respuesta).catch(() => {});
    } else {
      await interaction.reply(respuesta).catch(() => {});
    }
  }
});

if (!config.TOKEN) {
  console.error("Falta el token. Crea la variable DISCORD_TOKEN en Railway.");
  process.exit(1);
}

client.login(config.TOKEN);