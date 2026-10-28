import express from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import crypto from "node:crypto";
import { deleteChannel, loadChannels, saveChannel, tokenStoreInfo } from "./token-store.mjs";
import multer from "multer";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { enqueueJobs, listJobs, loadQueue, retryJob, runWorker } from "./upload-queue.mjs";

const app = express();
const port = Number(process.env.PORT || 8787);
app.disable("x-powered-by");
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? [process.env.ALLOWED_ORIGIN]
  : ["http://127.0.0.1:1420", "http://localhost:1420", "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost", "null"];
app.use(cors({ origin: allowedOrigins }));
app.use(express.json({ limit: "32kb" }));
app.use("/api/ai", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false }));

const oauthSessions = new Map();
const connectedChannels = new Map();
const upload = multer({ dest: path.join(os.tmpdir(), "channelflow-uploads"), limits: { fileSize: 256 * 1024 * 1024 * 1024 } });
const base64url = value => value.toString("base64url");
const execFileAsync = promisify(execFile);

function oauthConfig() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || `http://127.0.0.1:${port}/api/youtube/oauth/callback`
  };
}

app.get("/api/youtube/auth/status", (_req, res) => res.json({ configured: Boolean(oauthConfig().clientId), tokenStore: tokenStoreInfo.backend, channels: [...connectedChannels.values()].map(({ token: _token, ...channel }) => channel) }));

app.delete("/api/youtube/channels/:channelId", async (req, res) => {
  const channelId = req.params.channelId;
  if (!connectedChannels.has(channelId)) return res.status(404).json({ error: "ไม่พบช่องที่เชื่อมต่อ" });
  await deleteChannel(channelId);
  connectedChannels.delete(channelId);
  res.json({ ok: true });
});
app.patch("/api/youtube/channels/:channelId/preferences", async (req, res) => {
  const channel = connectedChannels.get(req.params.channelId);
  if (!channel) return res.status(404).json({ error: "ไม่พบช่องที่เชื่อมต่อ" });
  const allowedLanguages = ["Thai", "English", "Japanese", "Korean", "Chinese", "Spanish"];
  const primaryLanguage = String(req.body?.primaryLanguage || "");
  if (!allowedLanguages.includes(primaryLanguage)) return res.status(400).json({ error: "ภาษาที่เลือกไม่รองรับ" });
  const updated = { ...channel, primaryLanguage };
  await saveChannel(updated);
  connectedChannels.set(channel.id, updated);
  const { token: _token, ...publicChannel } = updated;
  res.json({ channel: publicChannel });
});

app.get("/api/uploads/jobs", (_req, res) => res.json({ jobs: listJobs() }));
app.post("/api/uploads/jobs", upload.single("video"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "กรุณาเลือกไฟล์วิดีโอ" });
    const channelIds = JSON.parse(req.body.channelIds || "[]");
    if (!Array.isArray(channelIds) || !channelIds.length) return res.status(400).json({ error: "กรุณาเลือกอย่างน้อยหนึ่งช่อง" });
    const title = String(req.body.title || req.file.originalname).trim().slice(0, 100);
    const publishAt = req.body.publishAt ? new Date(req.body.publishAt).toISOString() : null;
    if (publishAt && new Date(publishAt).getTime() <= Date.now() + 60_000) return res.status(400).json({ error: "เวลาตั้งเผยแพร่ต้องอยู่ในอนาคตมากกว่า 1 นาที" });
    const audioTracks = JSON.parse(req.body.audioTracks || "[]");
    const jobs = await enqueueJobs({ filePath: req.file.path, originalName: req.file.originalname, title, description: String(req.body.description || ""), publishAt, channelIds, audioTracks: Array.isArray(audioTracks) ? audioTracks : [] });
    res.status(201).json({ jobs });
  } catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "สร้างคิวไม่สำเร็จ" }); }
});
app.post("/api/media/audio-tracks", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "กรุณาเลือกไฟล์วิดีโอ" });
  try {
    const probe = await execFileAsync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index,codec_name,channels:stream_disposition=default:stream_tags=language,title", "-of", "json", req.file.path]);
    const streams = JSON.parse(probe.stdout).streams || [];
    const tracks = streams.map((stream, position) => ({
      streamIndex: stream.index, position, codec: stream.codec_name, channels: stream.channels,
      language: !stream.tags?.language || stream.tags.language === "und" ? "Unknown" : stream.tags.language,
      title: stream.tags?.title || `Audio ${position + 1}`, isDefault: Boolean(stream.disposition?.default) || position === 0
    }));
    res.json({ tracks });
  } catch { res.status(422).json({ error: "ไม่สามารถตรวจสอบแทร็กเสียงของไฟล์นี้ได้" }); }
  finally { await fs.rm(req.file.path, { force: true }).catch(() => {}); }
});
app.post("/api/uploads/jobs/:id/retry", async (req, res) => (await retryJob(req.params.id)) ? res.json({ ok: true }) : res.status(404).json({ error: "ไม่พบงานที่ลองใหม่ได้" }));

function createYoutubeAuthUrl(returnTo) {
  const config = oauthConfig();
  if (!config.clientId) return null;
  const state = base64url(crypto.randomBytes(32));
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  oauthSessions.set(state, { verifier, expiresAt: Date.now() + 10 * 60_000, returnTo });
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    prompt: "consent select_account",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

app.post("/api/youtube/auth/start", (_req, res) => {
  const authUrl = createYoutubeAuthUrl("channelflow://oauth-success");
  if (!authUrl) return res.status(503).json({ error: "ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID" });
  res.json({ authUrl });
});
app.get("/api/youtube/auth/redirect", (req, res) => {
  const requestedReturn = typeof req.query.returnTo === "string" ? req.query.returnTo : "";
  const returnTo = requestedReturn.startsWith("tauri://localhost/") || requestedReturn.startsWith("channelflow://") || requestedReturn.startsWith("http://127.0.0.1:1420/") || requestedReturn.startsWith("http://localhost:1420/")
    ? requestedReturn
    : undefined;
  const authUrl = createYoutubeAuthUrl(returnTo);
  if (!authUrl) return res.status(503).send("ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID");
  res.redirect(authUrl);
});

app.get("/api/youtube/oauth/callback", async (req, res) => {
  const { code, state, error } = req.query;
  const session = typeof state === "string" ? oauthSessions.get(state) : null;
  if (typeof state === "string") oauthSessions.delete(state);
  if (error || !session || session.expiresAt < Date.now() || typeof code !== "string") return res.status(400).send("<h2>เชื่อมต่อไม่สำเร็จ</h2><p>กรุณาปิดหน้าต่างนี้แล้วลองใหม่</p>");
  try {
    const config = oauthConfig();
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: config.clientId, ...(config.clientSecret ? { client_secret: config.clientSecret } : {}), redirect_uri: config.redirectUri, grant_type: "authorization_code", code_verifier: session.verifier })
    });
    const token = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error("token exchange failed");
    const channelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true", { headers: { Authorization: `Bearer ${token.access_token}` } });
    const channelPayload = await channelResponse.json();
    const channel = channelPayload.items?.[0];
    if (!channelResponse.ok || !channel) throw new Error("channel lookup failed");
    const connectedChannel = {
      id: channel.id, title: channel.snippet.title, thumbnail: channel.snippet.thumbnails?.default?.url || "",
      subscribers: channel.statistics?.hiddenSubscriberCount ? null : channel.statistics?.subscriberCount,
      connectedAt: new Date().toISOString(), primaryLanguage: "Thai", token
    };
    await saveChannel(connectedChannel);
    connectedChannels.set(channel.id, connectedChannel);
    const returnUrl = session.returnTo || process.env.APP_RETURN_URL || "http://127.0.0.1:1420/?oauth=success";
    res.send(`<meta charset='utf-8'><style>body{font-family:system-ui;text-align:center;padding:60px}</style><h2>เชื่อมต่อ YouTube สำเร็จ ✓</h2><p>กำลังกลับไป ChannelFlow...</p><script>setTimeout(()=>location.href=${JSON.stringify(returnUrl)},900)</script>`);
  } catch {
    res.status(502).send("<h2>เชื่อมต่อไม่สำเร็จ</h2><p>ตรวจสอบ Google OAuth configuration แล้วลองใหม่</p>");
  }
});

const metadataSchema = {
  type: "object", additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 100 },
    description: { type: "string", minLength: 1, maxLength: 5000 },
    tags: { type: "array", items: { type: "string" }, maxItems: 15 },
    suggestedLocalTime: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" },
    rationale: { type: "string", maxLength: 300 }
  },
  required: ["title", "description", "tags", "suggestedLocalTime", "rationale"]
};

function mockMetadata(brief, language) {
  const thai = language === "th";
  return {
    title: thai ? "ทำ YouTube หลายช่องให้ง่ายขึ้นด้วย AI" : "Manage Multiple YouTube Channels with AI",
    description: thai ? `เรียนรู้วิธีจัดการหลายช่อง YouTube อย่างเป็นระบบด้วย AI\n\nเนื้อหา: ${brief}` : `Learn how to manage multiple YouTube channels with AI.\n\nTopic: ${brief}`,
    tags: thai ? ["YouTubeTips", "AIContent", "CreatorTools"] : ["YouTubeTips", "AI", "CreatorTools"],
    suggestedLocalTime: "19:30",
    rationale: thai ? "ช่วงเย็นเหมาะเป็นค่าเริ่มต้นสำหรับกลุ่มผู้ชมครีเอเตอร์" : "Evening is a useful starting point for creator audiences."
  };
}

function normalizeMetadata(value) {
  const time = typeof value?.suggestedLocalTime === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.suggestedLocalTime) ? value.suggestedLocalTime : "19:30";
  return {
    title: String(value?.title || "วิดีโอใหม่").slice(0, 100),
    description: String(value?.description || "").slice(0, 5000),
    tags: Array.isArray(value?.tags) ? value.tags.map(String).filter(Boolean).slice(0, 15) : [],
    suggestedLocalTime: time,
    rationale: String(value?.rationale || "").slice(0, 300)
  };
}

async function localMetadata(brief, language, channelName) {
  const baseUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const preferredModel = process.env.OLLAMA_MODEL || "qwen3:4b";
  const installed = await fetch(`${baseUrl}/api/tags`).then(response => response.json());
  const model = installed.models?.some(item => item.name === preferredModel) ? preferredModel : installed.models?.[0]?.name;
  if (!model) throw new Error("No local model installed");
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: metadataSchema,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: "Create accurate YouTube metadata. Do not invent claims. Return JSON matching the provided schema." },
        { role: "user", content: `Language: ${language}\nChannel: ${channelName}\nVideo brief:\n${brief}` }
      ]
    })
  });
  if (!response.ok) throw new Error("Local AI request failed");
  const payload = await response.json();
  return JSON.parse(payload.message.content);
}

async function extractVideoPreview(videoPath) {
  const previewPath = `${videoPath}-preview.jpg`;
  let duration = "unknown";
  try {
    const probe = await execFileAsync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", videoPath]);
    duration = `${Math.round(Number(probe.stdout.trim()) || 0)} seconds`;
    await execFileAsync(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-i", videoPath, "-vf", "fps=1/5,scale=512:-1,tile=2x2", "-frames:v", "1", previewPath]);
    return { duration, image: (await fs.readFile(previewPath)).toString("base64") };
  } finally { await fs.rm(previewPath, { force: true }).catch(() => {}); }
}

function videoMetadataPrompt({ filename, duration, language, channelName }) {
  return `Analyze the attached contact sheet sampled from a YouTube video. Create compelling but accurate metadata in ${language}.\nFilename: ${filename}\nDuration: ${duration}\nTarget channels: ${channelName || "unspecified"}\nWrite a natural curiosity-driven title similar to successful YouTube channels in this content category without copying anyone. Optimize for viewer retention and follows without clickbait or unverifiable claims. Description should hook viewers in the first two lines and include a brief call to subscribe. Return 5-12 relevant hashtag words in tags without # signs. Suggested time is only a general recommendation.`;
}

async function localVideoMetadata(context, image) {
  const baseUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
  const preferredModel = process.env.OLLAMA_MODEL || "gemma4:e4b";
  const installed = await fetch(`${baseUrl}/api/tags`).then(response => response.json());
  const model = installed.models?.some(item => item.name === preferredModel) ? preferredModel : installed.models?.[0]?.name;
  if (!model) throw new Error("No local model installed");
  const response = await fetch(`${baseUrl}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
    model, stream: false, format: metadataSchema, options: { temperature: 0.3 },
    messages: [{ role: "system", content: "You are a YouTube packaging strategist. Be engaging, accurate, and return only the requested JSON." }, { role: "user", content: videoMetadataPrompt(context), images: [image] }]
  }) });
  if (!response.ok) throw new Error("Local vision request failed");
  return JSON.parse((await response.json()).message.content);
}

async function managedVideoMetadata(context, image) {
  if (!process.env.OPENAI_API_KEY) throw new Error("Managed AI key is not configured");
  const upstream = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({
    model: process.env.OPENAI_MODEL || "gpt-6-astra",
    instructions: "You are a YouTube packaging strategist. Be engaging and accurate. Never claim events not visible in the supplied video frames.",
    input: [{ role: "user", content: [{ type: "input_text", text: videoMetadataPrompt(context) }, { type: "input_image", image_url: `data:image/jpeg;base64,${image}` }] }],
    text: { format: { type: "json_schema", name: "youtube_metadata", strict: true, schema: metadataSchema } }
  }) });
  const payload = await upstream.json();
  if (!upstream.ok) throw new Error("Managed AI request failed");
  const outputText = payload.output?.flatMap(item => item.content ?? []).find(item => item.type === "output_text")?.text;
  if (!outputText) throw new Error("Managed AI returned no output");
  return JSON.parse(outputText);
}

app.get("/api/health", async (_req, res) => {
  let localAi = false;
  try { localAi = (await fetch(`${process.env.OLLAMA_URL || "http://127.0.0.1:11434"}/api/tags`)).ok; } catch {}
  res.json({ ok: true, localAi, managedAi: Boolean(process.env.OPENAI_API_KEY), localModel: process.env.OLLAMA_MODEL || "qwen3:4b" });
});
app.post("/api/ai/metadata", async (req, res) => {
  const { brief, provider = "local", language = "th", channelName = "" } = req.body ?? {};
  if (typeof brief !== "string" || brief.trim().length < 3 || brief.length > 6000) return res.status(400).json({ error: "brief must contain 3-6000 characters" });
  if (provider === "local") {
    try { return res.json({ data: normalizeMetadata(await localMetadata(brief.trim(), language, channelName)), mode: "local" }); }
    catch { return res.status(503).json({ error: "ไม่พบ Local AI กรุณาเปิด Ollama และติดตั้งโมเดล qwen3:4b" }); }
  }
  if (!process.env.OPENAI_API_KEY) return res.json({ data: mockMetadata(brief.trim(), language), mode: "mock" });
  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json", "X-Client-Request-Id": crypto.randomUUID() },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-6-astra",
        instructions: "Create accurate YouTube metadata. Never invent claims absent from the brief. Return concise natural metadata in the requested language. A suggested time is only a starting recommendation, not a claim based on channel analytics.",
        input: `Language: ${language}\nChannel: ${channelName}\nVideo brief:\n${brief.trim()}`,
        text: { format: { type: "json_schema", name: "youtube_metadata", strict: true, schema: metadataSchema } }
      })
    });
    const payload = await upstream.json();
    if (!upstream.ok) return res.status(502).json({ error: "AI provider request failed", requestId: upstream.headers.get("x-request-id") });
    const outputText = payload.output?.flatMap(item => item.content ?? []).find(item => item.type === "output_text")?.text;
    if (!outputText) return res.status(502).json({ error: "AI provider returned no structured output" });
    return res.json({ data: normalizeMetadata(JSON.parse(outputText)), mode: "live" });
  } catch (error) {
    console.error("metadata_generation_failed", error instanceof Error ? error.message : "unknown");
    return res.status(502).json({ error: "AI service is temporarily unavailable" });
  }
});

app.post("/api/ai/video-metadata", upload.single("video"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "กรุณาเลือกไฟล์วิดีโอ" });
  try {
    const provider = req.body.provider === "managed" ? "managed" : "local";
    const context = { filename: req.file.originalname, language: String(req.body.language || "Thai"), channelName: String(req.body.channelName || ""), ...(await extractVideoPreview(req.file.path)) };
    const data = provider === "managed" ? await managedVideoMetadata(context, context.image) : await localVideoMetadata(context, context.image);
    return res.json({ data: normalizeMetadata(data), mode: provider });
  } catch (error) {
    console.error("video_metadata_failed", error instanceof Error ? error.message : "unknown");
    return res.status(503).json({ error: "AI วิเคราะห์วิดีโอไม่สำเร็จ กรุณาตรวจสอบว่า Ollama เปิดอยู่หรือเลือก Managed AI" });
  } finally { await fs.rm(req.file.path, { force: true }).catch(() => {}); }
});

for (const channel of await loadChannels()) connectedChannels.set(channel.id, channel);
await loadQueue();
void runWorker();
app.listen(port, "127.0.0.1", () => console.log(`ChannelFlow API listening on http://127.0.0.1:${port} (${connectedChannels.size} secure channel(s), ${tokenStoreInfo.backend})`));
