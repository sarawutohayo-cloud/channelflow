import { apiUrl } from "./apiBase";

export type AiMetadata = { title: string; description: string; tags: string[]; suggestedLocalTime: string; rationale: string };
export type AiProvider = "local" | "managed";

export async function generateMetadata(brief: string, provider: AiProvider): Promise<AiMetadata> {
  const response = await fetch(apiUrl("/api/ai/metadata"), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ brief, provider, language: "th", channelName: "Creator Lab TH" })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "ไม่สามารถเชื่อมต่อ AI ได้");
  return payload.data;
}

export async function generateVideoMetadata(input: { file: File; provider: AiProvider; language: string; channelName: string }): Promise<AiMetadata> {
  const form = new FormData();
  form.set("video", input.file);
  form.set("provider", input.provider);
  form.set("language", input.language);
  form.set("channelName", input.channelName);
  const response = await fetch(apiUrl("/api/ai/video-metadata"), { method: "POST", body: form });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "AI วิเคราะห์วิดีโอไม่สำเร็จ");
  return payload.data;
}
