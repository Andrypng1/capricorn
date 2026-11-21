const { contextBridge, ipcRenderer } = require("electron");

const commands = [
  "snapshot", "save", "archive", "open_link", "open_folder", "copy_link", "theme", "palette",
  "invoice_template", "invoice_logo", "invoice_receipt", "invoice_preview", "invoice_export",
  "project_details", "save_payment", "save_payment_receipt", "remove_payment_receipt", "create_delivery", "create_revision", "update_revision", "check_link", "link_secret", "data_settings", "backup_folder", "backup_now", "data_file",
  "edit_delivery", "remove_delivery", "edit_revision", "remove_revision",
  "social_api_settings", "discover_social", "parse_social", "add_socials",
  "save_social", "remove_social",
  "add_links", "auto_client_avatar", "client_avatar", "link_thumbnail",
  "change_project_status", "read_clipboard", "desktop_settings",
];
contextBridge.exposeInMainWorld("capricorn", { ...Object.fromEntries(commands.map((command) => [
  command, (args = {}) => ipcRenderer.invoke("capricorn:" + command, args),
])),
  onShortcut(callback) {
    const listener = (_event, command, url) => callback(command, url);
    ipcRenderer.on("capricorn:shortcut", listener);
    return () => ipcRenderer.removeListener("capricorn:shortcut", listener);
  },
});
