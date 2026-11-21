const { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, shell, Tray } = require("electron");
const { existsSync, realpathSync, statSync } = require("node:fs");
const { isAbsolute, join, normalize } = require("node:path");
const { pathToFileURL } = require("node:url");
const { template, readReceipt, suggest, invoiceHtml } = require("./invoices.cjs");
const { profileImage, imageFromUrl } = require("./avatars.cjs");
const { credential } = require("./credentials.cjs");
const { driveImage, localImage, toThumbnail } = require("./thumbnails.cjs");
const { checkLink } = require("./check.cjs");
const { discover, candidates, providers, verifyProfiles } = require("./social-discovery.cjs");
const { connect, webUrl, serviceFor } = require("./store.cjs");

const page = join(__dirname, "../dist/index.html");
const windowIcon = app.isPackaged
  ? join(process.resourcesPath, "capricorn-zodiac.ico")
  : join(__dirname, "icon.ico");
let window;
let tray;
let db;
let quitting = false;
let shortcut;
let housekeeping;
let clipboardTimer;
let lastClipboard;
let smokeOpenedUrl;
const avatarAttempts = new Map();
const sessionFolders = new Map();
const folderKey = (path) => normalize(path).replace(/[\\/]+$/,"").toLowerCase();

function showWindow(command, url) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  if (command) window.webContents.send("capricorn:shortcut", command, url);
}

function createWindow() {
  window = new BrowserWindow({
    title:"Capricorn", width:1180, height:760, minWidth:780, minHeight:540, show:false,
    backgroundColor:"#171513", icon:windowIcon,
    webPreferences: {
      preload:join(__dirname, "preload.cjs"), contextIsolation:true, nodeIntegration:false, sandbox:true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action:"deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.on("close", (event) => {
    if (tray && !quitting && db.desktopSettings().hideToTray) {
      event.preventDefault();
      window.hide();
    }
  });
  window.once("ready-to-show", () => showWindow());
  return window.loadFile(page);
}

function bindCommands() {
  const handlers = {
    snapshot: () => db.snapshot(),
    save: ({ record }) => db.save(record),
    archive: ({ entity, id }) => db.archive(entity, id),
    change_project_status: ({ id, status }) => db.changeProjectStatus(id, status),
    theme: ({ value }) => db.theme(value),
    palette: ({ value }) => db.palette(value),
    open_link: ({ url }) => {
      const target = webUrl(url).href;
      if (process.argv.includes("--smoke-test")) { smokeOpenedUrl = target; return; }
      return shell.openExternal(target);
    },
    open_folder: async ({ path }) => {
      if (typeof path !== "string" || !isAbsolute(path)) throw new Error("La carpeta debe tener una ruta absoluta.");
      const key = folderKey(path);
      const known = [app.getPath("userData"),dataSettings().folder].find((folder) => folder && folderKey(folder) === key);
      let target = known;
      const approved = sessionFolders.get(key);
      if (!target && approved) {
        try { if (folderKey(realpathSync(path)) === folderKey(approved)) target = approved; }
        catch { sessionFolders.delete(key); }
      }
      if (!target) {
        const { canceled,filePaths } = await dialog.showOpenDialog(window,{
          title:"Confirma la carpeta que quieres abrir", properties:["openDirectory"],
        });
        if (canceled || !filePaths[0]) return;
        target = realpathSync(filePaths[0]);
        sessionFolders.set(folderKey(filePaths[0]),target);
      }
      if (!statSync(target,{ throwIfNoEntry:false })?.isDirectory()) throw new Error("La carpeta debe existir.");
      const error = await shell.openPath(target);
      if (error) throw new Error(error);
    },
    copy_link: ({ url }) => clipboard.writeText(webUrl(url).href),
    discover_social: ({ url }) => discover(url, webUrl, (id) => credential("get", id)),
    social_api_settings: async ({ provider, token, clientId, remove }) => {
      if (provider === undefined) {
        return Object.fromEntries(await Promise.all(Object.entries(providers).map(async ([key, value]) =>
          [key, Boolean(await credential("get", value.id))])));
      }
      if (!Object.hasOwn(providers, provider)) throw new Error("Plataforma desconocida.");
      const { id } = providers[provider];
      if (remove === true) {
        await credential("delete", id);
        return false;
      }
      if (typeof token !== "string" || !/^[a-z0-9._-]{10,950}$/i.test(token.trim()))
        throw new Error("Introduce una clave o un token válido.");
      if (provider === "twitch" && (typeof clientId !== "string" || !/^[a-z0-9]{8,100}$/i.test(clientId.trim())))
        throw new Error("Introduce el Client ID de Twitch.");
      await credential("set", id, JSON.stringify({ token:token.trim(), clientId:provider === "twitch" ? clientId.trim() : undefined }));
      return true;
    },
    parse_social: ({ text }) => {
      if (typeof text !== "string" || text.length > 30000) throw new Error("Pega hasta 30.000 caracteres.");
      return verifyProfiles(candidates(text, webUrl));
    },
    add_socials: (args) => db.addSocials(args),
    save_social: (args) => db.saveSocial(args),
    remove_social: (args) => db.removeSocial(args),
    project_details: ({ id }) => db.projectDetails(id),
    invoice_template: ({ value }) => {
      if (value === undefined) return template(db.getSetting("invoice_template", {}));
      const design = template(value);
      db.putSetting("invoice_template", design);
      return design;
    },
    invoice_logo: async () => {
      const response = await dialog.showOpenDialog(window, { properties:["openFile"], filters:[{name:"Logotipo",extensions:["png","jpg","jpeg","webp"]}] });
      if (response.canceled) return null;
      return "data:image/jpeg;base64," + await encodeAvatar(localImage(response.filePaths[0]));
    },
    invoice_receipt: async ({ pasted, text }) => {
      if (typeof text === "string") return suggest(text);
      if (pasted) {
        const image = clipboard.readImage();
        if (image.isEmpty()) throw new Error("El portapapeles no contiene una captura.");
        const fs = require("node:fs");
        const folder = fs.mkdtempSync(join(app.getPath("temp"), "capricorn-ocr-"));
        const filename = join(folder,"receipt.png");
        try {
          fs.writeFileSync(filename,image.toPNG());
          return await readReceipt(filename);
        } finally {
          if (fs.existsSync(filename)) fs.unlinkSync(filename);
          fs.rmdirSync(folder);
        }
      }
      const response = await dialog.showOpenDialog(window,{
        properties:["openFile"], filters:[{name:"Comprobantes",extensions:["pdf","png","jpg","jpeg","bmp","docx","txt"]}],
      });
      return response.canceled ? null : readReceipt(response.filePaths[0]);
    },
    invoice_preview: ({ design, form }) => invoiceHtml(design, form, true),
    invoice_export: async ({ design, form }) => {
      const html = invoiceHtml(design, form);
      const filename = String(form.number).replace(/[^a-z0-9_-]/gi,"-").slice(0,60);
      const selected = await dialog.showSaveDialog(window, {
        defaultPath:"Factura-" + filename + ".pdf", filters:[{ name:"PDF", extensions:["pdf"] }],
      });
      if (selected.canceled || !selected.filePath) return false;
      const print = new BrowserWindow({ show:false, webPreferences:{ sandbox:true, contextIsolation:true, nodeIntegration:false } });
      print.webContents.setWindowOpenHandler(() => ({action:"deny"}));
      try {
        await print.loadURL("data:text/html;base64," + Buffer.from(html,"utf8").toString("base64"));
        const pdf = await print.webContents.printToPDF({ pageSize:"A4", printBackground:true, preferCSSPageSize:true });
        require("node:fs").writeFileSync(selected.filePath,pdf);
        return true;
      } finally { print.destroy(); }
    },
    save_payment_receipt: (args) => db.savePaymentReceipt(args),
    remove_payment_receipt: ({ id }) => db.removePaymentReceipt(id),
    save_payment: (args) => db.savePayment(args),
    create_delivery: (args) => db.createDelivery(args),
    edit_delivery: (args) => db.editDelivery(args),
    remove_delivery: (args) => db.removeDelivery(args),
    edit_revision: (args) => db.editRevision(args),
    remove_revision: (args) => db.removeRevision(args),
    create_revision: (args) => db.createRevision(args),
    update_revision: (args) => db.updateRevision(args),
    check_link: ({ id }) => checkLink(db, id),
    add_links: (args) => db.addLinks(args),
    auto_client_avatar: ({ id }) => automaticAvatar(id),
    client_avatar: async ({ id, operation, socialId, url }) => {
      const current = db.getAvatar(id);
      const dataUrl = (jpeg) => jpeg ? "data:image/jpeg;base64," + jpeg : null;
      if (operation === "get") return dataUrl(current);
      if (operation === "remove") { db.setAvatar(id, null); return null; }
      let bytes;
      if (operation === "local") {
        const { canceled, filePaths } = await dialog.showOpenDialog(window, {
          properties:["openFile"], filters:[{ name:"Imágenes", extensions:["jpg","jpeg","png","webp"] }],
        });
        if (canceled) return undefined;
        bytes = localImage(filePaths[0]);
      } else if (operation === "paste") {
        const image = clipboard.readImage();
        if (image.isEmpty()) throw new Error("Copia la foto como imagen en el navegador y vuelve a pulsar Pegar foto.");
        const { width, height } = image.getSize();
        const scale = Math.min(1, 360 / Math.max(width,height));
        bytes = image.resize({ width:Math.max(1,Math.round(width*scale)), height:Math.max(1,Math.round(height*scale)) }).toPNG();
      } else if (operation === "url") bytes = await imageFromUrl(url);
      else if (operation === "social") bytes = await profileImage(db.avatarProfile(id, socialId), webUrl, (key) => credential("get", key));
      else throw new Error("Operación de foto inválida.");
      const jpeg = await encodeAvatar(bytes);
      db.setAvatar(id, jpeg);
      return dataUrl(jpeg);
    },
    link_thumbnail: async ({ id, operation }) => {
      const link = db.findLink(id);
      const dataUrl = (jpeg) => jpeg ? "data:image/jpeg;base64," + jpeg : null;
      if (operation === "get") return dataUrl(db.getThumbnail(id));
      if (operation === "remove") { db.setThumbnail(id, null); return null; }
      let bytes;
      if (operation === "drive" && link.service === "drive") bytes = await driveImage(link.url);
      else if (operation === "local") {
        const { canceled, filePaths } = await dialog.showOpenDialog(window, {
          properties:["openFile"], filters:[{ name:"Imágenes", extensions:["jpg","jpeg","png"] }],
        });
        if (canceled) return undefined;
        bytes = localImage(filePaths[0]);
      } else throw new Error("Operación de miniatura inválida.");
      if (db.findLink(id).url !== link.url) throw new Error("El enlace cambió antes de guardar la miniatura.");
      const jpeg = toThumbnail(nativeImage, bytes);
      db.setThumbnail(id, jpeg);
      return dataUrl(jpeg);
    },
    link_secret: async ({ id, action, password }) => {
      db.findLink(id);
      if (action === "set") {
        if (typeof password !== "string" || !password.length || password.length > 1280) throw new Error("Contraseña inválida.");
        await credential("set", id, password);
        db.setSecretFlag(id, true);
      } else if (action === "delete") {
        await credential("delete", id);
        db.setSecretFlag(id, false);
      } else if (["get","copy"].includes(action)) {
        const value = await credential("get", id);
        if (value === null) throw new Error("La contraseña no está en el almacén de este usuario.");
        if (action === "copy") clipboard.writeText(value);
        else return value;
      } else {
        throw new Error("Operación no válida.");
      }
    },
    data_settings: ({ settings }) => {
      const current = dataSettings();
      if (!settings) return current;
      const { days, copies } = settings;
      if (!Number.isInteger(days) || days < 0 || days > 30 || !Number.isInteger(copies) || copies < 1 || copies > 30)
        throw new Error("Revisa el plazo y el número de copias.");
      const next = { ...current, days, copies };
      db.putSetting("data_settings", next);
      return next;
    },
    backup_folder: async ({ clear }) => {
      const current = dataSettings();
      if (!clear) {
        const { canceled, filePaths } = await dialog.showOpenDialog(window, { properties:["openDirectory"] });
        if (canceled) return current;
        current.folder = filePaths[0];
      } else current.folder = "";
      db.putSetting("data_settings", current);
      return current;
    },
    backup_now: () => runBackup(true),
    data_file: ({ operation }) => dataFile(operation),
    read_clipboard: () => clipboard.readText(),
    desktop_settings: ({ settings }) => {
      if (settings === undefined) return db.desktopSettings();
      if (typeof settings.hideToTray !== "boolean" || typeof settings.startWithWindows !== "boolean" || typeof settings.monitorClipboard !== "boolean")
        throw new Error("Ajustes de escritorio inválidos.");
      const next = { shortcut:validateShortcut(settings.shortcut), hideToTray:settings.hideToTray, startWithWindows:settings.startWithWindows, monitorClipboard:settings.monitorClipboard };
      const previous = db.desktopSettings();
      registerShortcut(next.shortcut);
      try {
        app.setLoginItemSettings({ openAtLogin:next.startWithWindows });
        const saved = db.setDesktopSettings(next);
        configureClipboardMonitor(saved.monitorClipboard);
        return saved;
      } catch (error) {
        registerShortcut(previous.shortcut);
        app.setLoginItemSettings({ openAtLogin:previous.startWithWindows });
        throw error;
      }
    },
  };
  const pageUrl = pathToFileURL(page).href;
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle("capricorn:" + name, (event, args) => {
      if (event.sender !== window?.webContents || event.senderFrame?.url !== pageUrl)
        throw new Error("Origen no autorizado.");
      return handler(args);
    });
  }
}

function configureClipboardMonitor(enabled) {
  clearInterval(clipboardTimer);
  if (!enabled) {
    lastClipboard = undefined;
    return;
  }
  lastClipboard = clipboard.readText();
  clipboardTimer = setInterval(() => {
    const candidate = clipboard.readText();
    if (candidate === lastClipboard) return;
    lastClipboard = candidate;
    if (window.isFocused() || candidate.length > 8192 || !Notification.isSupported()) return;
    let url;
    try { url = webUrl(candidate); } catch { return; }
    if (serviceFor(url) === "generic") return;
    const notification = new Notification({ title:"Capricorn", body:"Hay un enlace compatible en el portapapeles. Pulsa para guardarlo." });
    notification.on("click", () => showWindow("capture", url.href));
    notification.show();
  }, 2500);
}

function automaticAvatar(id) {
  if (process.argv.includes("--smoke-test")) return false;
  if (avatarAttempts.has(id)) return avatarAttempts.get(id);
  const attempt = fillAvatar(id).finally(() => avatarAttempts.delete(id));
  avatarAttempts.set(id, attempt);
  return attempt;
}

async function fillAvatar(id) {
  if (db.getAvatar(id)) return false;
  const profiles = db.avatarProfiles(id).filter(({ platform }) =>
    ["konect","twitch","youtube","kick","instagram","tiktok","x","threads","behance","facebook"].includes(platform)).slice(0,5);
  for (const profile of profiles) {
    let jpeg;
    try {
      const bytes = await profileImage(profile, webUrl, (key) => credential("get", key));
      jpeg = await encodeAvatar(bytes);
    } catch { continue; }
    if (db.getAvatar(id)) return false;
    db.setAvatar(id, jpeg);
    return true;
  }
  return false;
}

async function encodeAvatar(bytes) {
  const webp = bytes.subarray(0,4).toString("ascii") === "RIFF" && bytes.subarray(8,12).toString("ascii") === "WEBP";
  if (!webp) return toThumbnail(nativeImage, bytes);
  const data = JSON.stringify(bytes.toString("base64"));
  const png = await window.webContents.executeJavaScript(`
    (async () => {
      const input = Uint8Array.from(atob(` + data + `), (char) => char.charCodeAt(0));
      const image = await createImageBitmap(new Blob([input], { type:"image/webp" }));
      try {
        const size = Math.min(1, 360 / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * size));
        canvas.height = Math.max(1, Math.round(image.height * size));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/png").split(",")[1];
      } finally { image.close(); }
    })()
  `);
  return toThumbnail(nativeImage, Buffer.from(png, "base64"));
}

function dataSettings() {
  return db.getSetting("data_settings", { days:2, copies:5, folder:"" });
}

function runBackup(force) {
  const { folder, copies } = dataSettings();
  if (!folder) {
    if (force) throw new Error("Elige la carpeta de respaldo.");
    return;
  }
  const lastBackup = db.getSetting("last_backup", 0);
  if (force || Date.now() - lastBackup >= 86400000) {
    db.rotate(folder, copies);
    db.putSetting("last_backup", Date.now());
  }
}

function runAlerts() {
  if (!Notification.isSupported()) return;
  const links = db.dueLinks(dataSettings().days);
  const existing = new Set(db.getSetting("alerted_links", []));
  const fresh = links.filter((link) => !existing.has(link.id + ":" + link.expires_at));
  if (fresh.length) {
    const notification = new Notification({
      title:"Capricorn · Material por vencer",
      body:fresh.length === 1 ? fresh[0].title + " · " + fresh[0].expires_at : String(fresh.length) + " enlaces pendientes próximos a vencer.",
    });
    notification.on("click", () => showWindow("today"));
    notification.show();
  }
  db.putSetting("alerted_links", links.map((link) => link.id + ":" + link.expires_at));
}

async function dataFile(operation) {
  const backupFilter = { name:"Copia Capricorn", extensions:["capricorn"] };
  if (operation === "import") {
    const result = await dialog.showOpenDialog(window, { properties:["openFile"], filters:[backupFilter] });
    if (result.canceled) return false;
    const confirmation = await dialog.showMessageBox(window, {
      type:"warning", title:"Restaurar copia", message:"La copia sustituirá los clientes, sus redes sociales, proyectos, enlaces, entregas, revisiones y pagos actuales.",
      detail:"Exporta una copia de tus datos actuales antes de continuar.",
      buttons:["Cancelar","Restaurar"], defaultId:0, cancelId:0,
    });
    if (confirmation.response !== 1) return false;
    db.restoreArchive(result.filePaths[0]);
    return true;
  }
  const isArchive = operation === "export";
  if (!isArchive && !["links","deliveries"].includes(operation)) throw new Error("Operación inválida.");
  const file = await dialog.showSaveDialog(window, {
    defaultPath:isArchive ? "Capricorn.capricorn" : operation === "links" ? "Enlaces.csv" : "Entregas.csv",
    filters:[isArchive ? backupFilter : { name:"CSV", extensions:["csv"] }],
  });
  if (file.canceled || !file.filePath) return false;
  if (isArchive) db.writeArchive(file.filePath);
  else db.exportCsv(file.filePath, operation);
  return true;
}

function validateShortcut(value) {
  if (typeof value !== "string" || !/^Control\+(?:Alt|Shift)\+[A-Z0-9]$/.test(value))
    throw new Error("Usa Control+Shift+letra o Control+Alt+letra.");
  return value;
}

function registerShortcut(next) {
  if (next === shortcut) return;
  if (!globalShortcut.register(next, () => showWindow("capture")))
    throw new Error("El atajo ya está en uso. Elige otro.");
  if (shortcut) globalShortcut.unregister(shortcut);
  shortcut = next;
}

async function start() {
  if (process.argv.includes("--self-test")) {
    require("./self-test.cjs").selfTest();
    console.log("Electron: SQLite, tres servicios y persistencia verificados.");
    app.exit(0);
    return;
  }
  app.setAppUserModelId("local.capricorn.desktop");
  Menu.setApplicationMenu(null);
  const legacy = join(process.env.LOCALAPPDATA || app.getPath("appData"), "local.capricorn.desktop", "capricorn.sqlite3");
  const current = join(app.getPath("userData"), "capricorn.sqlite3");
  const smoke = process.argv.includes("--smoke-test");
  db = connect(smoke ? ":memory:" : existsSync(current) || !existsSync(legacy) ? current : legacy);
  bindCommands();
  await createWindow();
  if (smoke) {
    const result = await window.webContents.executeJavaScript(`
      (async () => {
        const api = window.capricorn;
        const call = (command, args) => api[command](args);
        const client = await call("save", { record:{entity:"client", name:"Ventana de prueba"} });
        await call("save_social", { clientId:client, url:"instagram.com/capricorn_demo", label:"Portafolio" });
        const project = await call("save", { record:{entity:"project", title:"Montaje", client_id:client, status:"editing"} });
        const link = await call("save", { record:{entity:"link", project_id:project, title:"Entrega", kind:"delivery",
          url:"https://example.com/entrega", download_status:"pending", expires_at:"2000-01-01"} });
        await call("save_payment", { id:project, price:3500, payment_status:"partial" });
        await call("create_delivery", { id:project, linkId:link, notes:"Primer corte" });
        await call("create_delivery", { id:project, linkId:link, notes:"Versión final" });
        await call("create_revision", { id:project, text:"Revisar títulos" });
        const batch = await call("add_links", { projectId:project, kind:"material",
          text:["https://drive.google.com/file/d/file123/view","https://drive.google.com/file/d/file123/view","https://dropbox.com/s/example"].join(String.fromCharCode(10))
        });
        const details = await call("project_details", { id:project });
        await call("update_revision", { id:details.revisions[0].id, projectId:project, done:true });
        const revised = await call("project_details", { id:project });
        const health = await call("check_link", { id:link });
        const saved = await call("snapshot");
        const preferences = await call("data_settings");
        await call("link_secret", { id:link, action:"set", password:"capricorn-vault-test" });
        try {
          const password = await call("link_secret", { id:link, action:"get" });
          const passed = document.title === "Capricorn"
            && saved.clients.some((row) => row.id === client)
            && revised.deliveries.map((delivery) => delivery.version).join(",") === "2,1"
            && revised.revisions[0].done === 1
            && revised.payment.payment_status === "partial"
            && health.health === "expired"
            && preferences.days === 2
            && batch.count === 2 && batch.skipped === 1
            && password === "capricorn-vault-test";
          return { passed, link };
        } finally {
          await call("link_secret", { id:link, action:"delete" });
        }
      })()
    `);
    if (!result.passed) throw new Error("No se pudo verificar la ventana Electron.");
    const pixel = nativeImage.createFromBitmap(Buffer.alloc(64, 255), { width:4, height:4 }).toPNG();
    db.setThumbnail(result.link, toThumbnail(nativeImage, pixel));
    const thumbnail = await window.webContents.executeJavaScript(
      "window.capricorn.link_thumbnail({ operation:'get', id:" + JSON.stringify(result.link) + " })"
    );
    if (!thumbnail.startsWith("data:image/jpeg;base64,/9j/")) throw new Error("La miniatura no llegó a la ventana.");
    await window.loadFile(page);
    const ui = await window.webContents.executeJavaScript(`
      (async () => {
        async function waitFor(find) {
          for (let attempt = 0; attempt < 40; attempt++) {
            const element = find();
            if (element) return element;
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          throw new Error("El contenido de prueba no apareció.");
        }
        const project = await waitFor(() => [...document.querySelectorAll("button.project")]
          .find((button) => button.textContent.includes("Montaje")));
        const oldPage = document.querySelector(".page-enter");
        project.click();
        const icon = await waitFor(() => document.querySelector('[data-service="drive"] img'));
        await icon.decode();
        const image = await waitFor(() => document.querySelector(".link-thumb img"));
        await image.decode();
        const page = document.querySelector(".page-enter");
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (icon.naturalWidth !== 120 || page === oldPage ||
            getComputedStyle(page).animationName !== (reduced ? "none" : "capricorn-panel-slide")) return false;
        if (document.querySelector(".payment-register, input[name='price']")) return false;
        const initial = await waitFor(() => document.querySelector(".revision-row"));
        [...initial.querySelectorAll("button")].find((button) => button.textContent === "Editar").click();
        const dialog = await waitFor(() => document.querySelector("dialog[open]"));
        dialog.querySelector("textarea").value = "Ajustar créditos";
        dialog.querySelector("form").requestSubmit();
        const edited = await waitFor(() => [...document.querySelectorAll(".revision-row")]
          .find((row) => row.textContent.includes("Ajustar créditos") && !row.querySelector("button").disabled));
        if (!edited.querySelector("input").checked) return false;
        [...edited.querySelectorAll("button")].find((button) => button.textContent === "Eliminar").click();
        const confirmation = await waitFor(() => document.querySelector("dialog[open] .danger-button"));
        confirmation.click();
        await waitFor(() => document.querySelector(".revision-row") ? null : document.querySelector(".delivery-history"));
        if (document.querySelectorAll(".version-mark").length !== 2) return false;
        const profile = await waitFor(() => document.querySelector('[data-platform="instagram"]'));
        await profile.querySelector("img").decode();
        profile.click();
        const clients = [...document.querySelectorAll("nav button")].find((button) => button.textContent === "Clientes");
        clients.click();
        const manage = await waitFor(() => [...document.querySelectorAll("button")].find((button) => button.textContent === "Administrar redes"));
        manage.click();
        const socialDialog = await waitFor(() => document.querySelector(".social-dialog[open]"));
        const edit = [...socialDialog.querySelectorAll(".social-list button")].find((button) => button.textContent === "Editar");
        edit.click();
        const input = socialDialog.querySelector('input[name="profile"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        setter.call(input, "https://www.youtube.com/@capricorn_demo");
        input.dispatchEvent(new Event("input", { bubbles:true }));
        await new Promise((resolve) => setTimeout(resolve, 60));
        socialDialog.querySelector("form").requestSubmit();
        await waitFor(() => socialDialog.querySelector(".social-list .social-youtube") &&
          !socialDialog.querySelector(".social-list button").disabled && socialDialog.querySelector(".social-list"));
        const remove = [...socialDialog.querySelectorAll(".social-list button")].find((button) => button.textContent === "Quitar");
        remove.click();
        const removeButton = await waitFor(() => socialDialog.querySelector(".danger-button"));
        removeButton.click();
        await waitFor(() => socialDialog.querySelector(".social-list") ? null : socialDialog.querySelector(".notice"));
        return true;
      })()
    `);
    if (!ui) throw new Error("La navegación o los iconos de servicio no se pudieron verificar.");
    if (smokeOpenedUrl !== "https://instagram.com/capricorn_demo") throw new Error("El perfil no abrió la dirección esperada.");
    console.log("Electron: icono social, destino del perfil, edición y eliminación verificados.");
    app.exit(0);
    return;
  }
  tray = new Tray(windowIcon);
  tray.setToolTip("Capricorn");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label:"Abrir", click:() => showWindow() },
    { label:"Captura rápida", click:() => showWindow("capture") },
    { label:"Próximos vencimientos", click:() => showWindow("today") },
    { type:"separator" },
    { label:"Salir", click:() => app.quit() },
  ]));
  tray.on("double-click", () => showWindow());
  function checkSchedule() {
    try { runAlerts(); } catch (error) { console.warn(error.message); }
    try { runBackup(false); } catch (error) { console.warn(error.message); }
  }
  configureClipboardMonitor(db.desktopSettings().monitorClipboard);
  checkSchedule();
  housekeeping = setInterval(checkSchedule, 15 * 60 * 1000);
  try {
    registerShortcut(db.desktopSettings().shortcut);
  } catch (error) {
    console.warn(error.message);
  }
}

if (!process.argv.some((arg) => ["--self-test", "--smoke-test"].includes(arg)) && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => { quitting = true; });
  app.on("will-quit", () => {
    clearInterval(housekeeping);
    clearInterval(clipboardTimer);
    globalShortcut.unregisterAll();
    db?.close();
  });
  app.whenReady().then(start).catch((error) => {
    console.error(error);
    if (!process.argv.some((arg) => ["--self-test", "--smoke-test"].includes(arg))) {
      dialog.showErrorBox("Capricorn", String(error));
    }
    app.exit(1);
  });
}
