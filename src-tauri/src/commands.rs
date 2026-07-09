use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub fn get_sidecar_port() -> u16 {
    22140
}

#[tauri::command]
pub async fn open_file_dialog(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let file_path = app
        .dialog()
        .file()
        .add_filter("Documents", &["pdf", "docx", "csv", "xlsx", "xls"])
        .blocking_pick_file();

    match file_path {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

