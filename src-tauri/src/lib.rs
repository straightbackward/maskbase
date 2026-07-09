mod commands;
mod sidecar;

use sidecar::SidecarState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        // Register SidecarState as managed state so it lives for the entire app lifetime
        // and its Drop impl kills the backend process when the app exits.
        .manage(SidecarState::new())
        .setup(|app| {
            let state = app.state::<SidecarState>();
            if let Err(e) = state.spawn(&app.handle()) {
                eprintln!("Warning: Failed to spawn backend sidecar: {e}");
                eprintln!("The app will start but document scanning and AI chat will be unavailable.");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_sidecar_port,
            commands::open_file_dialog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
