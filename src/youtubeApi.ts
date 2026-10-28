import { apiUrl } from "./apiBase";

export type YoutubeChannel = { id: string; title: string; thumbnail: string; subscribers: string | null; connectedAt: string; primaryLanguage?: string };

export async function getYoutubeStatus(): Promise<{ configured: boolean; channels: YoutubeChannel[] }> {
  const response = await fetch(apiUrl("/api/youtube/auth/status"));
  if (!response.ok) throw new Error("ตรวจสอบ YouTube ไม่สำเร็จ");
  return response.json();
}

export async function startYoutubeAuth(): Promise<string> {
  const response = await fetch(apiUrl("/api/youtube/auth/start"), { method: "POST" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "เริ่มการเชื่อมต่อไม่สำเร็จ");
  return payload.authUrl;
}

export async function deleteYoutubeChannel(channelId: string): Promise<void> {
  const response = await fetch(apiUrl(`/api/youtube/channels/${encodeURIComponent(channelId)}`), { method: "DELETE" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "ลบช่องไม่สำเร็จ");
}

export async function updateChannelLanguage(channelId: string, primaryLanguage: string): Promise<YoutubeChannel> {
  const response = await fetch(apiUrl(`/api/youtube/channels/${encodeURIComponent(channelId)}/preferences`), {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ primaryLanguage })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "บันทึกภาษาหลักไม่สำเร็จ");
  return payload.channel;
}
