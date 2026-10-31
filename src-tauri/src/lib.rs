pub mod export;
pub mod media;
pub mod tools;

use export::run::{self, Job};
use export::ExportSpec;
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct ActiveExport(Mutex<Option<Arc<Job>>>);

fn media_cache(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("media");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command(async)]
fn probe_media(app: AppHandle, path: String) -> Result<media::ProbeInfo, String> {
    let info = media::probe(&path)?;
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| e.to_string())?;
    Ok(info)
}

#[tauri::command(async)]
fn make_thumbnails(
    app: AppHandle,
    id: String,
    path: String,
    duration: f64,
) -> Result<media::Thumbs, String> {
    media::thumbnails(&path, duration, &media_cache(&app)?.join(id))
}

#[tauri::command(async)]
fn make_waveform(path: String) -> Result<Vec<f32>, String> {
    media::waveform(&path)
}

#[tauri::command(async)]
fn make_proxy(app: AppHandle, id: String, path: String) -> Result<String, String> {
    media::proxy(&path, &media_cache(&app)?.join(id).join("proxy.mp4"))
}

#[tauri::command(async)]
fn list_encoders() -> Vec<String> {
    tools::available_encoders()
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Finished {
    outcome: Option<export::Outcome>,
    error: Option<export::ExportError>,
}

#[tauri::command]
fn start_export(
    app: AppHandle,
    active: State<ActiveExport>,
    spec: ExportSpec,
) -> Result<(), String> {
    let mut slot = active.0.lock().unwrap();
    if slot.is_some() {
        return Err("An export is already running".into());
    }
    let job = Arc::new(Job::default());
    *slot = Some(job.clone());

    thread::spawn(move || {
        let progress_app = app.clone();
        let result = run::export(&spec, &job, &mut |progress| {
            let _ = progress_app.emit("export-progress", progress);
        });
        *app.state::<ActiveExport>().0.lock().unwrap() = None;
        let finished = match result {
            Ok(outcome) => Finished { outcome: Some(outcome), error: None },
            Err(error) => Finished { outcome: None, error: Some(error) },
        };
        let _ = app.emit("export-finished", finished);
    });
    Ok(())
}

#[tauri::command]
fn cancel_export(active: State<ActiveExport>) {
    if let Some(job) = active.0.lock().unwrap().as_ref() {
        job.cancel();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(ActiveExport::default())
        .setup(|app| {
            // Edits don't outlive the app, so neither do their thumbnails and proxies.
            let dir = media_cache(app.handle())?;
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir)?;
            app.asset_protocol_scope().allow_directory(&dir, true)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_media,
            make_thumbnails,
            make_waveform,
            make_proxy,
            list_encoders,
            start_export,
            cancel_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running Videotay");
}
