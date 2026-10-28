import { useEffect, useMemo, useState } from "react";
import { Bot, CalendarClock, CheckCircle2, ChevronRight, Clock3, LayoutDashboard, Play, Plus, Settings, Sparkles, Trash2, UploadCloud, Users, WandSparkles } from "lucide-react";
import { generateMetadata, generateVideoMetadata, type AiMetadata, type AiProvider } from "./api";
import { deleteYoutubeChannel, getYoutubeStatus, startYoutubeAuth, updateChannelLanguage, type YoutubeChannel } from "./youtubeApi";
import { analyzeAudioTracks, createUploadJobs, getUploadJobs, type AudioTrack, type UploadJob } from "./uploadApi";
import { apiUrl } from "./apiBase";

type JobStatus = "scheduled" | "uploading" | "draft";
type Job = { id: number; title: string; channel: string; when: string; status: JobStatus; progress?: number };

const initialJobs: Job[] = [
  { id: 1, title: "5 เทคนิคตัดต่อให้คนดูไม่เลื่อนผ่าน", channel: "Creator Lab TH", when: "29 ต.ค. 2026 · 19:30", status: "scheduled" },
  { id: 2, title: "AI Workflow สำหรับครีเอเตอร์", channel: "Work Smarter", when: "30 ต.ค. 2026 · 12:00", status: "uploading", progress: 68 },
  { id: 3, title: "เบื้องหลังการทำคลิป 1 นาที", channel: "Behind the Edit", when: "ยังไม่กำหนด", status: "draft" }
];

const labels = { scheduled: "ตั้งเวลาแล้ว", uploading: "กำลังอัปโหลด", draft: "ฉบับร่าง" };

export default function App() {
  const [jobs, setJobs] = useState(initialJobs);
  const [showComposer, setShowComposer] = useState(false);
  const [brief, setBrief] = useState("");
  const [generated, setGenerated] = useState<AiMetadata | null>(null);
  const [provider, setProvider] = useState<AiProvider>("local");
  const [generating, setGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [showChannels, setShowChannels] = useState(false);
  const [channels, setChannels] = useState<YoutubeChannel[]>([]);
  const [youtubeConfigured, setYoutubeConfigured] = useState(false);
  const [youtubeError, setYoutubeError] = useState("");
  const [deletingChannelId, setDeletingChannelId] = useState<string | null>(null);
  const [pendingDeleteChannel, setPendingDeleteChannel] = useState<YoutubeChannel | null>(null);
  const [savingLanguageId, setSavingLanguageId] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDescription, setUploadDescription] = useState("");
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("19:30");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [uploadJobs, setUploadJobs] = useState<UploadJob[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [submittingUpload, setSubmittingUpload] = useState(false);
  const [uploadAiProvider, setUploadAiProvider] = useState<AiProvider>("local");
  const [uploadLanguage, setUploadLanguage] = useState("Thai");
  const [analyzingVideo, setAnalyzingVideo] = useState(false);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [analyzingAudio, setAnalyzingAudio] = useState(false);
  const stats = useMemo(() => ({ queued: uploadJobs.filter(job => job.status === "queued" || job.status === "uploading").length, channels: channels.length, month: uploadJobs.filter(job => job.status === "scheduled" || job.status === "private").length }), [uploadJobs, channels]);

  useEffect(() => {
    const refresh = () => getUploadJobs().then(setUploadJobs).catch(() => {});
    refresh(); const timer = window.setInterval(refresh, 2000); return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const refresh = () => getYoutubeStatus().then(status => { setChannels(status.channels); setYoutubeConfigured(status.configured); }).catch(() => {});
    refresh(); const timer = window.setInterval(refresh, 2000); return () => window.clearInterval(timer);
  }, []);

  async function runAi() {
    if (!brief.trim()) return;
    setGenerating(true); setAiError("");
    try { setGenerated(await generateMetadata(brief, provider)); }
    catch (error) { setAiError(error instanceof Error ? error.message : "ไม่สามารถเชื่อมต่อ AI ได้"); }
    finally { setGenerating(false); }
  }

  function addDraft() {
    setJobs(v => [{ id: Date.now(), title: generated?.title || brief, channel: "Creator Lab TH", when: `1 พ.ย. 2026 · ${generated?.suggestedLocalTime || "19:30"}`, status: "scheduled" }, ...v]);
    setShowComposer(false); setBrief(""); setGenerated(null); setAiError("");
  }

  async function openChannels() {
    setShowChannels(true); setYoutubeError("");
    try { const status = await getYoutubeStatus(); setChannels(status.channels); setYoutubeConfigured(status.configured); }
    catch (error) { setYoutubeError(error instanceof Error ? error.message : "เชื่อมต่อไม่สำเร็จ"); }
  }

  async function connectYoutube() {
    setYoutubeError("");
    try {
      if (window.location.protocol === "file:") {
        const authUrl = await startYoutubeAuth();
        window.open(authUrl, "_blank");
        return;
      }
      const returnTo = window.location.protocol === "tauri:" ? "tauri://localhost/?oauth=success" : window.location.protocol === "file:" ? "channelflow://oauth-success" : window.location.origin + "/?oauth=success";
      window.location.assign(apiUrl(`/api/youtube/auth/redirect?returnTo=${encodeURIComponent(returnTo)}`));
    } catch (error) { setYoutubeError(error instanceof Error ? error.message : "เชื่อมต่อไม่สำเร็จ"); }
  }

  async function confirmRemoveChannel() {
    const channel = pendingDeleteChannel;
    if (!channel) return;
    setDeletingChannelId(channel.id); setYoutubeError("");
    try {
      await deleteYoutubeChannel(channel.id);
      setChannels(current => current.filter(item => item.id !== channel.id));
      setSelectedChannels(current => current.filter(id => id !== channel.id));
      setPendingDeleteChannel(null);
    } catch (error) { setYoutubeError(error instanceof Error ? error.message : "ลบช่องไม่สำเร็จ"); }
    finally { setDeletingChannelId(null); }
  }

  async function saveChannelLanguage(channel: YoutubeChannel, primaryLanguage: string) {
    setSavingLanguageId(channel.id); setYoutubeError("");
    try {
      const updated = await updateChannelLanguage(channel.id, primaryLanguage);
      setChannels(current => current.map(item => item.id === channel.id ? updated : item));
    } catch (error) { setYoutubeError(error instanceof Error ? error.message : "บันทึกภาษาหลักไม่สำเร็จ"); }
    finally { setSavingLanguageId(null); }
  }

  function toggleUploadChannel(channelId: string, checked: boolean) {
    const next = checked ? [...selectedChannels, channelId] : selectedChannels.filter(id => id !== channelId);
    setSelectedChannels(next);
    const languages = [...new Set(channels.filter(channel => next.includes(channel.id)).map(channel => channel.primaryLanguage || "Thai"))];
    if (languages.length === 1) setUploadLanguage(languages[0]);
  }

  async function openUpload() {
    setShowUpload(true); setUploadError("");
    try { const status = await getYoutubeStatus(); setChannels(status.channels); setSelectedChannels(status.channels.map(channel => channel.id)); const languages = [...new Set(status.channels.map(channel => channel.primaryLanguage || "Thai"))]; if (languages.length === 1) setUploadLanguage(languages[0]); }
    catch (error) { setUploadError(error instanceof Error ? error.message : "โหลดช่องไม่สำเร็จ"); }
  }

  async function submitUpload() {
    if (!uploadFile) return setUploadError("กรุณาเลือกไฟล์วิดีโอ");
    if (!selectedChannels.length) return setUploadError("กรุณาเลือกอย่างน้อยหนึ่งช่อง");
    setSubmittingUpload(true); setUploadError("");
    try {
      const publishAt = scheduleDate ? new Date(`${scheduleDate}T${scheduleTime}`).toISOString() : null;
      await createUploadJobs({ file: uploadFile, title: uploadTitle || uploadFile.name.replace(/\.[^.]+$/, ""), description: uploadDescription, publishAt, channelIds: selectedChannels, audioTracks });
      setUploadJobs(await getUploadJobs()); setShowUpload(false); setUploadFile(null); setUploadTitle(""); setUploadDescription(""); setScheduleDate("");
    } catch (error) { setUploadError(error instanceof Error ? error.message : "สร้างคิวไม่สำเร็จ"); }
    finally { setSubmittingUpload(false); }
  }

  async function selectUploadFile(file: File | null) {
    setUploadFile(file); setAudioTracks([]); setUploadError("");
    if (!file) return;
    if (!uploadTitle) setUploadTitle(file.name.replace(/\.[^.]+$/, ""));
    setAnalyzingAudio(true);
    try {
      const tracks = await analyzeAudioTracks(file);
      setAudioTracks(tracks.map((track, index) => ({ ...track, language: track.language === "Unknown" && index === 0 ? uploadLanguage : track.language, isDefault: index === 0 })));
    } catch (error) { setUploadError(error instanceof Error ? error.message : "ตรวจสอบแทร็กเสียงไม่สำเร็จ"); }
    finally { setAnalyzingAudio(false); }
  }

  function updateAudioTrack(position: number, language: string) {
    setAudioTracks(current => current.map(track => track.position === position ? { ...track, language } : track));
    const main = audioTracks.find(track => track.position === position && track.isDefault);
    if (main) setUploadLanguage(language);
  }

  async function analyzeUploadVideo() {
    if (!uploadFile) return setUploadError("กรุณาเลือกไฟล์วิดีโอก่อน");
    setAnalyzingVideo(true); setUploadError("");
    try {
      const selectedNames = channels.filter(channel => selectedChannels.includes(channel.id)).map(channel => channel.title).join(", ");
      const result = await generateVideoMetadata({ file: uploadFile, provider: uploadAiProvider, language: uploadLanguage, channelName: selectedNames });
      setUploadTitle(result.title);
      setUploadDescription(`${result.description}\n\n${result.tags.map(tag => `#${tag.replace(/^#/, "")}`).join(" ")}`.trim());
      setScheduleTime(result.suggestedLocalTime);
    } catch (error) { setUploadError(error instanceof Error ? error.message : "AI วิเคราะห์วิดีโอไม่สำเร็จ"); }
    finally { setAnalyzingVideo(false); }
  }

  return <div className="shell">
    <aside>
      <div className="brand"><div className="brandmark"><Play size={20} fill="currentColor" /></div><div><strong>ChannelFlow</strong><small>AI YouTube Publisher</small></div></div>
      <nav>
        <button className="active"><LayoutDashboard />ภาพรวม</button>
        <button><UploadCloud />คิวอัปโหลด</button>
        <button><CalendarClock />ปฏิทิน</button>
        <button onClick={openChannels}><Users />ช่อง YouTube</button>
        <button><Bot />AI Studio <span className="new">ใหม่</span></button>
      </nav>
      <div className="sidebottom"><button><Settings />ตั้งค่า</button><div className="profile"><div className="avatar">AK</div><div><b>Admin Kit</b><small>Pro workspace</small></div></div></div>
    </aside>
    <main>
      <header><div><p className="eyebrow">วันพุธที่ 28 ตุลาคม</p><h1>สวัสดีครับ 👋</h1><p>จัดการทุกช่องและปล่อยวิดีโอให้ตรงเวลาในที่เดียว</p></div><button className="primary" onClick={openUpload}><Plus />สร้างงานอัปโหลด</button></header>
      <section className="stats">
        <article><span className="icon violet"><UploadCloud /></span><div><small>งานในคิว</small><strong>{stats.queued}</strong><em>พร้อมดำเนินการ</em></div></article>
        <article><span className="icon cyan"><Users /></span><div><small>ช่องที่เชื่อมต่อ</small><strong>{stats.channels}</strong><em className="good"><CheckCircle2 />ปกติทั้งหมด</em></div></article>
        <article><span className="icon orange"><Play /></span><div><small>เผยแพร่เดือนนี้</small><strong>{stats.month}</strong><em>วิดีโอ</em></div></article>
      </section>
      <section className="ai-card">
        <div className="spark"><Sparkles /></div><div><small>CHANNELFLOW AI</small><h2>ให้ AI เตรียมโพสต์แทนคุณ</h2><p>สร้างชื่อ คำอธิบาย แท็ก และแนะนำเวลาที่เหมาะกับแต่ละช่อง</p></div><button onClick={() => setShowComposer(true)}>เปิด AI Studio <ChevronRight /></button>
      </section>
      <section className="panel">
        <div className="panelhead"><div><h2>งานล่าสุด</h2><p>ติดตามสถานะอัปโหลดและกำหนดการเผยแพร่</p></div><button className="ghost">ดูทั้งหมด <ChevronRight /></button></div>
        <div className="table">
          {uploadJobs.map(job => <div className="row" key={job.id}>
            <div className="thumb"><UploadCloud /></div><div className="job"><b>{job.title}</b><small>{job.channelTitle || job.channelId}</small></div>
            <div className="when"><Clock3 /><span>{job.publishAt ? new Date(job.publishAt).toLocaleString("th-TH") : "Private"}</span></div>
            <div className={`status ${job.status === "failed" ? "draft" : job.status === "uploading" ? "uploading" : "scheduled"}`}>{job.status === "uploading" ? `กำลังอัปโหลด ${job.progress}%` : job.status === "queued" ? "รอในคิว" : job.status === "scheduled" ? "ตั้งเวลาแล้ว" : job.status === "private" ? "Private" : "ผิดพลาด"}</div><button className="dots">•••</button>
          </div>)}
          {jobs.map(job => <div className="row" key={job.id}>
            <div className="thumb"><Play fill="currentColor" /></div>
            <div className="job"><b>{job.title}</b><small>{job.channel}</small></div>
            <div className="when"><Clock3 /><span>{job.when}</span></div>
            <div className={`status ${job.status}`}>{job.status === "uploading" && <span className="dot" />}{labels[job.status]}{job.progress ? ` ${job.progress}%` : ""}</div>
            <button className="dots">•••</button>
          </div>)}
        </div>
      </section>
    </main>
    {showComposer && <div className="overlay" onMouseDown={() => setShowComposer(false)}><div className="modal" onMouseDown={e => e.stopPropagation()}>
      <div className="modalhead"><div className="magic"><WandSparkles /></div><div><h2>สร้างงานด้วย AI</h2><p>บอกหัวข้อหรือวางสคริปต์ แล้วให้ AI เตรียมข้อมูลโพสต์</p></div><button className="close" onClick={() => setShowComposer(false)}>×</button></div>
      <label>หัวข้อหรือเนื้อหาวิดีโอ<textarea value={brief} onChange={e => {setBrief(e.target.value); setGenerated(null); setAiError("")}} placeholder="เช่น วิดีโอสอนครีเอเตอร์จัดการหลายช่อง YouTube ด้วย AI..." /></label>
      <div className="formgrid"><label>ช่อง YouTube<select><option>Creator Lab TH</option><option>Work Smarter</option><option>Behind the Edit</option></select></label><label>ระบบ AI<select value={provider} onChange={e => setProvider(e.target.value as AiProvider)}><option value="local">Local AI — ฟรี</option><option value="managed">Managed AI — Cloud</option></select></label></div>
      {!generated ? <button className="ai-action" disabled={!brief.trim() || generating} onClick={runAi}><Sparkles />{generating ? "AI กำลังสร้าง..." : "สร้าง Metadata ด้วย AI"}</button> : <div className="result"><span><Sparkles /></span><div><small>ชื่อที่แนะนำ · เวลา {generated.suggestedLocalTime}</small><b>{generated.title}</b><p>{generated.tags.map(tag => `#${tag}`).join(" ")}</p></div></div>}
      {aiError && <p className="error">{aiError}</p>}
      <div className="modalfoot"><button className="cancel" onClick={() => setShowComposer(false)}>ยกเลิก</button><button className="primary" disabled={!brief.trim()} onClick={addDraft}>เพิ่มเข้าคิว</button></div>
    </div></div>}
    {showUpload && <div className="overlay" onMouseDown={() => setShowUpload(false)}><div className="modal upload-modal" onMouseDown={e => e.stopPropagation()}>
      <div className="modalhead"><div className="magic"><UploadCloud /></div><div><h2>สร้างงานอัปโหลด</h2><p>เลือกไฟล์ ช่องปลายทาง และเวลาที่ต้องการเผยแพร่</p></div><button className="close" onClick={() => setShowUpload(false)}>×</button></div>
      <label className="file-drop">วิดีโอ<input type="file" accept="video/*" onChange={e => selectUploadFile(e.target.files?.[0] || null)} /><span><UploadCloud />{uploadFile ? uploadFile.name : "คลิกเพื่อเลือกไฟล์วิดีโอ"}</span></label>
      {(analyzingAudio || audioTracks.length > 0) && <div className="audio-track-box"><b>แทร็กเสียงในวิดีโอ</b>{analyzingAudio ? <p>กำลังตรวจสอบแทร็กเสียง...</p> : audioTracks.map(track => <div className="audio-track-row" key={track.position}><span><strong>{track.isDefault ? "เสียงหลัก" : `เสียงรอง ${track.position + 1}`}</strong><small>{track.codec.toUpperCase()} · {track.channels} channels</small></span><select value={track.language} onChange={e => updateAudioTrack(track.position, e.target.value)}><option value="Unknown">ไม่ทราบภาษา</option><option value="Thai">ไทย</option><option value="English">English</option><option value="Japanese">日本語</option><option value="Korean">한국어</option><option value="Chinese">中文</option><option value="Spanish">Español</option></select></div>)}{audioTracks.length > 1 && <small className="studio-note">หลังอัปโหลด โปรแกรมจะแยกเสียงรองเป็นไฟล์ตามภาษาเพื่อเพิ่มใน YouTube Studio</small>}</div>}
      <div className="ai-upload-box"><div><b><Sparkles /> AI ช่วยคิดข้อมูลวิดีโอ</b><small>วิเคราะห์ภาพหลายช่วงเพื่อสร้างชื่อ คำอธิบาย และแฮชแท็กที่น่าสนใจ</small></div><div className="ai-upload-options"><select value={uploadLanguage} onChange={e => setUploadLanguage(e.target.value)}><option value="Thai">ภาษาไทย</option><option value="English">English</option><option value="Japanese">日本語</option><option value="Korean">한국어</option><option value="Chinese">中文</option><option value="Spanish">Español</option></select><select value={uploadAiProvider} onChange={e => setUploadAiProvider(e.target.value as AiProvider)}><option value="local">Local AI — ฟรี</option><option value="managed">Managed AI — Cloud</option></select><button type="button" disabled={!uploadFile || analyzingVideo} onClick={analyzeUploadVideo}><WandSparkles />{analyzingVideo ? "กำลังวิเคราะห์วิดีโอ..." : "ให้ AI ช่วยคิด"}</button></div></div>
      <label>ชื่อวิดีโอ<input className="text-input" value={uploadTitle} maxLength={100} onChange={e => setUploadTitle(e.target.value)} placeholder="ชื่อที่จะแสดงบน YouTube" /></label>
      <label>คำอธิบาย<textarea value={uploadDescription} onChange={e => setUploadDescription(e.target.value)} placeholder="คำอธิบายวิดีโอ (ไม่บังคับ)" /></label>
      <div className="channel-choices"><small>ช่องปลายทาง</small>{channels.map(channel => <label key={channel.id}><input type="checkbox" checked={selectedChannels.includes(channel.id)} onChange={e => toggleUploadChannel(channel.id, e.target.checked)} />{channel.thumbnail && <img src={channel.thumbnail} alt="" />}<span>{channel.title}<em>{channel.primaryLanguage || "Thai"}</em></span></label>)}</div>
      <div className="formgrid"><label>วันที่เผยแพร่<input className="text-input" type="date" value={scheduleDate} onChange={e => setScheduleDate(e.target.value)} /><small>เว้นว่างเพื่ออัปโหลดเป็น Private</small></label><label>เวลา<input className="text-input" type="time" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} disabled={!scheduleDate} /></label></div>
      {uploadError && <p className="error">{uploadError}</p>}
      <div className="modalfoot"><button className="cancel" onClick={() => setShowUpload(false)}>ยกเลิก</button><button className="primary" disabled={submittingUpload || !uploadFile || !selectedChannels.length} onClick={submitUpload}>{submittingUpload ? "กำลังเพิ่มเข้าคิว..." : `เพิ่มเข้าคิว ${selectedChannels.length} ช่อง`}</button></div>
    </div></div>}
    {showChannels && <div className="overlay" onMouseDown={() => setShowChannels(false)}><div className="modal channels-modal" onMouseDown={e => e.stopPropagation()}>
      <div className="modalhead"><div className="magic"><Users /></div><div><h2>ช่อง YouTube</h2><p>เชื่อมหลายบัญชีเพื่อจัดคิวและตั้งเวลาเผยแพร่</p></div><button className="close" onClick={() => setShowChannels(false)}>×</button></div>
      {channels.length ? <div className="channel-list">{channels.map(channel => <div className="channel-item" key={channel.id}>{channel.thumbnail ? <img src={channel.thumbnail} alt="" /> : <div className="avatar">YT</div>}<div className="channel-info"><b>{channel.title}</b><small>{channel.subscribers ? `${Number(channel.subscribers).toLocaleString()} subscribers` : channel.id}</small></div><label className="channel-language">ภาษาหลัก<select disabled={savingLanguageId === channel.id} value={channel.primaryLanguage || "Thai"} onChange={e => saveChannelLanguage(channel, e.target.value)}><option value="Thai">ไทย</option><option value="English">English</option><option value="Japanese">日本語</option><option value="Korean">한국어</option><option value="Chinese">中文</option><option value="Spanish">Español</option></select></label><span className="connected"><CheckCircle2 />เชื่อมต่อแล้ว</span><button className="delete-channel" disabled={deletingChannelId === channel.id} onClick={() => setPendingDeleteChannel(channel)} title={`ลบช่อง ${channel.title}`}><Trash2 />{deletingChannelId === channel.id ? "กำลังลบ..." : "ลบช่อง"}</button></div>)}</div> : <div className="empty-channel"><Users /><b>ยังไม่มีช่องที่เชื่อมต่อ</b><p>เข้าสู่ระบบ Google และเลือกช่อง YouTube ที่ต้องการจัดการ</p></div>}
      {youtubeError && <p className="error">{youtubeError}</p>}
      {!youtubeConfigured && <p className="setup-note">ต้องตั้งค่า GOOGLE_CLIENT_ID จาก Google Cloud ก่อนเชื่อมบัญชีจริง</p>}
      <div className="modalfoot"><button className="cancel" onClick={() => setShowChannels(false)}>ปิด</button><button className="primary" onClick={connectYoutube}><Plus />เชื่อมช่อง YouTube</button></div>
    </div></div>}
    {pendingDeleteChannel && <div className="overlay confirm-overlay" onMouseDown={() => !deletingChannelId && setPendingDeleteChannel(null)}><div className="modal confirm-modal" onMouseDown={e => e.stopPropagation()}>
      <div className="danger-icon"><Trash2 /></div><h2>ลบช่องออกจาก ChannelFlow?</h2><p>ต้องการลบช่อง <b>{pendingDeleteChannel.title}</b> และยกเลิกการเชื่อมต่อบัญชีนี้หรือไม่?</p><small>วิดีโอและช่องจริงบน YouTube จะไม่ถูกลบ</small>
      {youtubeError && <p className="error">{youtubeError}</p>}
      <div className="modalfoot"><button className="cancel" disabled={Boolean(deletingChannelId)} onClick={() => setPendingDeleteChannel(null)}>ยกเลิก</button><button className="confirm-delete" disabled={Boolean(deletingChannelId)} onClick={confirmRemoveChannel}><Trash2 />{deletingChannelId ? "กำลังลบ..." : "ยืนยันลบช่อง"}</button></div>
    </div></div>}
  </div>;
}
