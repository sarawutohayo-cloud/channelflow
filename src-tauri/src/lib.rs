use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Manager;

struct ApiProcess(Mutex<Option<Child>>);

#[tauri::command]
fn healthcheck() -> &'static str { "ChannelFlow desktop core is ready" }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![healthcheck])
        .setup(|app| {
            // This local desktop build starts the existing ChannelFlow API itself,
            // so opening the .app is enough to use OAuth, AI and the upload queue.
            let project_dir = "/Users/mr.ex/Desktop/youtube-multi-uploader";
            let child = Command::new("/opt/homebrew/bin/node")
                .args(["--env-file-if-exists=.env", "server/server.mjs"])
                .current_dir(project_dir)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .ok();
            app.manage(ApiProcess(Mutex::new(child)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building ChannelFlow");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<ApiProcess>() {
                if let Ok(mut guard) = state.0.lock() {
                    if let Some(child) = guard.as_mut() {
                        let _ = child.kill();
                    }
                }
            }
        }
    });
}
