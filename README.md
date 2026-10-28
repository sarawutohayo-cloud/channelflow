# ChannelFlow

Public desktop app for uploading and scheduling videos across multiple YouTube channels, with AI-assisted metadata and publishing recommendations.

## Windows installer and updates

Windows releases are built on a Windows runner and published from GitHub Actions. Run the `Windows Release` workflow with a semantic version such as `0.1.0`. It produces an NSIS installer, creates desktop and Start Menu shortcuts, registers the `channelflow://` OAuth callback, and publishes `latest.yml` for automatic updates. OAuth tokens are encrypted for the current Windows user with DPAPI.

The Windows release bundles FFmpeg and FFprobe. Google OAuth credentials are injected from the repository secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; managed AI keys are never bundled in the public client.

## MVP status

The current build includes the dashboard, upload queue, scheduling status, connected-channel overview, and an interactive AI metadata composer. It supports free Local AI through Ollama and an optional managed cloud provider. Google OAuth, resumable uploads, secure token storage, and SQLite persistence are the next implementation layer.

## Run the frontend

```bash
npm install
npm run dev
```

## Build the desktop app

Install the Rust toolchain and the platform prerequisites from the Tauri v2 documentation, then run:

```bash
npm install
npm run tauri dev
```

## Security model

- Never embed AI provider secrets in a public desktop binary.
- Use a backend proxy for managed AI plans, or OS keychain storage for user-supplied keys.
- Store Google refresh tokens only in macOS Keychain / Windows Credential Manager.
- Upload video bytes directly from the user's device to YouTube using resumable uploads.

## Free Local AI

Install Ollama, then download the default multilingual model once:

```bash
ollama pull qwen3:4b
```

Keep Ollama running and choose `Local AI — ฟรี` in the composer. The text stays on the user's device and no per-request API fee is charged. Change `OLLAMA_MODEL` to use a different installed model.

## Managed AI

Set `OPENAI_API_KEY` only in the server environment. The desktop app never receives the secret. The managed API uses schema-constrained output, validates input size, and rate-limits requests.

## Google OAuth and YouTube

Create an OAuth client of type **Desktop app** in Google Cloud, enable YouTube Data API v3, configure the consent screen, and set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the runtime environment. The development callback is `http://127.0.0.1:8787/api/youtube/oauth/callback`.

The authorization flow uses PKCE, a short-lived state value, offline access, and the minimum scopes currently needed to identify the user's channel and upload videos. On macOS, OAuth tokens are stored in Keychain under the service `com.channelflow.youtube`; only non-sensitive channel metadata is stored in `~/Library/Application Support/ChannelFlow/channels.json`. Windows Credential Manager integration remains required before the Windows public build.

Private resumable upload smoke test:

```bash
npm run upload:test -- /absolute/path/video.mov
```

The uploader refreshes OAuth access tokens, sends the video in 8 MiB chunks, retries transient network failures, and defaults to `private` visibility.

The desktop queue UI accepts a video file, one or more connected channels, optional description, and an optional local publish date/time. Queue state survives backend restarts. Completed temporary uploads are removed automatically after every selected channel finishes; failed jobs retain the source for retry.
