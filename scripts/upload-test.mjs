import { defaultTitle, uploadVideo } from "../server/youtube-upload.mjs";

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: node scripts/upload-test.mjs /absolute/path/video.mov");
const result = await uploadVideo({
  filePath,
  title: defaultTitle(filePath),
  description: "Private upload test from ChannelFlow",
  privacyStatus: "private",
  onProgress: progress => process.stdout.write(`\rUploading: ${progress.percent}%`)
});
process.stdout.write("\n");
console.log(JSON.stringify(result));
