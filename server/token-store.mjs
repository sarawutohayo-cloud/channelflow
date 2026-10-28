import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SERVICE = "com.channelflow.youtube";
const dataDir = process.platform === "darwin"
  ? path.join(os.homedir(), "Library", "Application Support", "ChannelFlow")
  : path.join(process.env.APPDATA || path.join(os.homedir(), ".channelflow"), "ChannelFlow");
const metadataPath = path.join(dataDir, "channels.json");

async function readMetadata() {
  try { return JSON.parse(await fs.readFile(metadataPath, "utf8")); }
  catch { return []; }
}

async function writeMetadata(channels) {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(metadataPath, JSON.stringify(channels, null, 2), { mode: 0o600 });
}

async function saveMacToken(channelId, token) {
  await execFileAsync("security", ["add-generic-password", "-U", "-a", channelId, "-s", SERVICE, "-w", JSON.stringify(token)]);
}

async function loadMacToken(channelId) {
  try {
    const { stdout } = await execFileAsync("security", ["find-generic-password", "-a", channelId, "-s", SERVICE, "-w"]);
    return JSON.parse(stdout.trim());
  } catch { return null; }
}

async function deleteMacToken(channelId) {
  try { await execFileAsync("security", ["delete-generic-password", "-a", channelId, "-s", SERVICE]); } catch {}
}

const windowsTokenDir = path.join(dataDir, "tokens");
const windowsTokenPath = channelId => path.join(windowsTokenDir, `${channelId.replace(/[^a-zA-Z0-9_-]/g, "_")}.dpapi`);

async function saveWindowsToken(channelId, token) {
  await fs.mkdir(windowsTokenDir, { recursive: true });
  const encoded = Buffer.from(JSON.stringify(token), "utf8").toString("base64");
  const script = "$p=$args[0];$plain=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($args[1]));$s=ConvertTo-SecureString $plain -AsPlainText -Force;$s|ConvertFrom-SecureString|Set-Content -LiteralPath $p";
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, windowsTokenPath(channelId), encoded]);
}

async function loadWindowsToken(channelId) {
  try {
    const script = "$s=Get-Content -Raw -LiteralPath $args[0]|ConvertTo-SecureString;$b=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s);try{[Runtime.InteropServices.Marshal]::PtrToStringBSTR($b)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b)}";
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script, windowsTokenPath(channelId)]);
    return JSON.parse(stdout.trim());
  } catch { return null; }
}

async function deleteWindowsToken(channelId) { await fs.rm(windowsTokenPath(channelId), { force: true }).catch(() => {}); }

export async function saveChannel(channel) {
  if (process.platform === "darwin") await saveMacToken(channel.id, channel.token);
  else if (process.platform === "win32") await saveWindowsToken(channel.id, channel.token);
  else throw new Error("Secure credential storage is not implemented for this platform");
  const metadata = await readMetadata();
  const publicChannel = { ...channel };
  delete publicChannel.token;
  const existing = metadata.find(item => item.id === channel.id);
  if (!publicChannel.primaryLanguage) publicChannel.primaryLanguage = existing?.primaryLanguage || "Thai";
  const next = [...metadata.filter(item => item.id !== channel.id), publicChannel];
  await writeMetadata(next);
}

export async function loadChannels() {
  const metadata = await readMetadata();
  const channels = [];
  for (const channel of metadata) {
    const token = process.platform === "darwin" ? await loadMacToken(channel.id) : process.platform === "win32" ? await loadWindowsToken(channel.id) : null;
    if (token) channels.push({ ...channel, token });
  }
  return channels;
}

export async function deleteChannel(channelId) {
  if (process.platform === "darwin") await deleteMacToken(channelId);
  if (process.platform === "win32") await deleteWindowsToken(channelId);
  await writeMetadata((await readMetadata()).filter(item => item.id !== channelId));
}

export const tokenStoreInfo = { service: SERVICE, backend: process.platform === "darwin" ? "macOS Keychain" : process.platform === "win32" ? "Windows DPAPI" : "unavailable" };
