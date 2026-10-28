const isDesktop = window.location.hostname === "tauri.localhost" || window.location.protocol === "tauri:" || window.location.protocol === "file:";

export const API_BASE = isDesktop ? "http://127.0.0.1:8787" : "";

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}
