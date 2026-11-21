type DesktopCommand = "snapshot" | "save" | "archive" | "open_link" | "open_folder" | "copy_link" |
  "invoice_template" | "invoice_logo" | "invoice_receipt" | "invoice_preview" | "invoice_export" |
  "project_details" | "save_payment" | "save_payment_receipt" | "remove_payment_receipt" | "create_delivery" | "create_revision" | "update_revision" | "check_link" | "link_secret" | "data_settings" | "backup_folder" | "backup_now" | "data_file" |
  "edit_delivery" | "remove_delivery" | "edit_revision" | "remove_revision" |
  "social_api_settings" | "discover_social" | "parse_social" | "add_socials" |
  "save_social" | "remove_social" |
  "add_links" | "auto_client_avatar" | "client_avatar" | "link_thumbnail" | "theme" | "palette" | "change_project_status" | "read_clipboard" | "desktop_settings";

declare global {
  interface Window {
    capricorn?: Record<DesktopCommand, (args?: object) => Promise<unknown>> & {
      onShortcut: (callback: (command: "capture" | "today", url?: string) => void) => () => void;
    };
  }
}

export async function invoke<T = unknown>(command: DesktopCommand, args?: object): Promise<T> {
  const api = window.capricorn;
  if (!api) throw new Error("Abre Capricorn desde la aplicación de escritorio.");
  return api[command](args) as Promise<T>;
}
