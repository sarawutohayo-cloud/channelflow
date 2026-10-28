import fs from "node:fs/promises";
import path from "node:path";
import { loadChannels, saveChannel } from "./token-store.mjs";

const CHUNK_SIZE = 8 * 1024 * 1024;

async function freshAccessToken(channel) {
  if (!channel.token?.refresh_token) return channel.token?.access_token;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET || "",
      refresh_token: channel.token.refresh_token,
      grant_type: "refresh_token"
    })
  });
  const refreshed = await response.json();
  if (!response.ok) throw new Error(`Google token refresh failed (${response.status})`);
  channel.token = { ...channel.token, ...refreshed, refresh_token: channel.token.refresh_token };
  await saveChannel(channel);
  return channel.token.access_token;
}

async function putChunk(uploadUrl, buffer, start, total, accessToken) {
  const end = start + buffer.length - 1;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Length": String(buffer.length),
          "Content-Range": `bytes ${start}-${end}/${total}`
        },
        body: buffer
      });
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
    }
  }
}

const languageCodes = { Thai: "th", English: "en", Japanese: "ja", Korean: "ko", Chinese: "zh-Hans", Spanish: "es" };

export async function uploadVideo({ filePath, channelId, title, description = "", privacyStatus = "private", publishAt, defaultAudioLanguage, onProgress = () => {} }) {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) throw new Error("Video path is not a file");
  const channels = await loadChannels();
  if (!channels.length) throw new Error("No securely connected YouTube channel");
  const channel = channelId ? channels.find(item => item.id === channelId) : channels[0];
  if (!channel) throw new Error("Selected YouTube channel is not connected");
  const accessToken = await freshAccessToken(channel);
  const status = { privacyStatus };
  if (publishAt) {
    status.privacyStatus = "private";
    status.publishAt = publishAt;
  }
  const initiation = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(stat.size),
      "X-Upload-Content-Type": "video/quicktime"
    },
    body: JSON.stringify({ snippet: { title: title.slice(0, 100), description, ...(defaultAudioLanguage && defaultAudioLanguage !== "Unknown" ? { defaultLanguage: languageCodes[defaultAudioLanguage] || defaultAudioLanguage, defaultAudioLanguage: languageCodes[defaultAudioLanguage] || defaultAudioLanguage } : {}) }, status })
  });
  if (!initiation.ok) throw new Error(`YouTube upload initiation failed (${initiation.status}): ${await initiation.text()}`);
  const uploadUrl = initiation.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube did not provide a resumable upload URL");

  const file = await fs.open(filePath, "r");
  let offset = 0;
  try {
    while (offset < stat.size) {
      const length = Math.min(CHUNK_SIZE, stat.size - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(buffer, 0, length, offset);
      const response = await putChunk(uploadUrl, buffer.subarray(0, bytesRead), offset, stat.size, accessToken);
      offset += bytesRead;
      onProgress({ uploadedBytes: offset, totalBytes: stat.size, percent: Math.round(offset / stat.size * 100) });
      if (response.status === 200 || response.status === 201) {
        const video = await response.json();
        return { videoId: video.id, title: video.snippet?.title || title, privacyStatus: video.status?.privacyStatus || status.privacyStatus, channelTitle: channel.title };
      }
      if (response.status !== 308) throw new Error(`YouTube chunk upload failed (${response.status}): ${await response.text()}`);
    }
  } finally { await file.close(); }
  throw new Error("Upload ended without a YouTube video response");
}

export function defaultTitle(filePath) { return path.basename(filePath, path.extname(filePath)).slice(0, 100); }
