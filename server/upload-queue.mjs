import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { uploadVideo } from "./youtube-upload.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const dataDir = path.join(os.homedir(), "Library", "Application Support", "ChannelFlow");
const queuePath = path.join(dataDir, "upload-queue.json");
let jobs = [];
let workerActive = false;

async function save() {
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(queuePath, JSON.stringify(jobs, null, 2), { mode: 0o600 });
}

export async function loadQueue() {
  try { jobs = JSON.parse(await fs.readFile(queuePath, "utf8")); }
  catch { jobs = []; }
  for (const job of jobs) if (job.status === "uploading") job.status = "queued";
  await save();
  return jobs;
}

export function listJobs() {
  return jobs.map(({ filePath: _filePath, ...job }) => job);
}

export async function enqueueJobs({ filePath, originalName, title, description, publishAt, channelIds, audioTracks = [] }) {
  const created = channelIds.map(channelId => ({
    id: crypto.randomUUID(), channelId, filePath, originalName, title, description, audioTracks,
    publishAt: publishAt || null, privacyStatus: publishAt ? "private" : "private",
    status: "queued", progress: 0, createdAt: new Date().toISOString(), videoId: null, error: null
  }));
  jobs.push(...created);
  await save();
  void runWorker();
  return created.map(({ filePath: _filePath, ...job }) => job);
}

export async function retryJob(id) {
  const job = jobs.find(item => item.id === id);
  if (!job || job.status !== "failed") return false;
  job.status = "queued"; job.error = null; job.progress = 0;
  await save(); void runWorker(); return true;
}

export async function runWorker() {
  if (workerActive) return;
  workerActive = true;
  try {
    let job;
    while ((job = jobs.find(item => item.status === "queued"))) {
      job.status = "uploading"; await save();
      try {
        const result = await uploadVideo({
          filePath: job.filePath, channelId: job.channelId, title: job.title,
          description: job.description, privacyStatus: job.privacyStatus, publishAt: job.publishAt,
          defaultAudioLanguage: job.audioTracks?.find(track => track.isDefault)?.language || job.audioTracks?.[0]?.language,
          onProgress: async progress => { job.progress = progress.percent; if (progress.percent % 20 === 0 || progress.percent === 100) await save(); }
        });
        job.status = job.publishAt ? "scheduled" : "private";
        job.videoId = result.videoId; job.channelTitle = result.channelTitle; job.progress = 100;
        const secondary = (job.audioTracks || []).filter(track => !track.isDefault);
        if (secondary.length) {
          const outputDir = path.join(dataDir, "audio-tracks", result.videoId);
          await fs.mkdir(outputDir, { recursive: true });
          job.preparedAudioTracks = [];
          for (const track of secondary) {
            const safeLanguage = String(track.language || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
            const outputPath = path.join(outputDir, `${safeLanguage}-audio-${track.position + 1}.m4a`);
            await execFileAsync(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-i", job.filePath, "-map", `0:${track.streamIndex}`, "-vn", "-c:a", "aac", "-b:a", "192k", outputPath]);
            job.preparedAudioTracks.push({ language: track.language, path: outputPath });
          }
          job.youtubeStudioUrl = `https://studio.youtube.com/video/${result.videoId}/translations`;
        }
        job.completedAt = new Date().toISOString();
      } catch (error) {
        job.status = "failed"; job.error = error instanceof Error ? error.message : "Upload failed";
      }
      const siblings = jobs.filter(item => item.filePath === job.filePath);
      if (siblings.length && siblings.every(item => item.status === "scheduled" || item.status === "private")) {
        try { await fs.unlink(job.filePath); } catch {}
        for (const sibling of siblings) sibling.filePath = null;
      }
      await save();
    }
  } finally { workerActive = false; }
}
