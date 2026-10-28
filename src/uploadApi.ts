import { apiUrl } from "./apiBase";

export type AudioTrack = { streamIndex: number; position: number; codec: string; channels: number; language: string; title: string; isDefault: boolean };
export type UploadJob = { id: string; channelId: string; channelTitle?: string; originalName: string; title: string; publishAt: string | null; status: "queued"|"uploading"|"scheduled"|"private"|"failed"; progress: number; videoId?: string; error?: string; preparedAudioTracks?: { language: string; path: string }[]; youtubeStudioUrl?: string };

export async function createUploadJobs(input: { file: File; title: string; description: string; publishAt: string | null; channelIds: string[]; audioTracks: AudioTrack[] }) {
  const form = new FormData();
  form.set("video", input.file); form.set("title", input.title); form.set("description", input.description);
  form.set("channelIds", JSON.stringify(input.channelIds));
  form.set("audioTracks", JSON.stringify(input.audioTracks));
  if (input.publishAt) form.set("publishAt", input.publishAt);
  const response = await fetch(apiUrl("/api/uploads/jobs"), { method: "POST", body: form });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "สร้างคิวไม่สำเร็จ");
  return payload.jobs as UploadJob[];
}

export async function analyzeAudioTracks(file: File): Promise<AudioTrack[]> {
  const form = new FormData(); form.set("video", file);
  const response = await fetch(apiUrl("/api/media/audio-tracks"), { method: "POST", body: form });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "ตรวจสอบแทร็กเสียงไม่สำเร็จ");
  return payload.tracks;
}

export async function getUploadJobs(): Promise<UploadJob[]> {
  const response = await fetch(apiUrl("/api/uploads/jobs"));
  if (!response.ok) throw new Error("โหลดคิวไม่สำเร็จ");
  return (await response.json()).jobs;
}
