use std::sync::Mutex;
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

/// Holds a reference to the running backend process so we can kill it on exit.
pub struct SidecarState {
    process: Mutex<Option<CommandChild>>,
}

impl SidecarState {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }

    /// Spawn the bundled backend binary via Tauri's sidecar mechanism.
    /// The binary must be at `src-tauri/binaries/backend-<target-triple>`.
    pub fn spawn(&self, app: &tauri::AppHandle) -> Result<(), String> {
        let mut proc = self.process.lock().map_err(|e| e.to_string())?;

        if proc.is_some() {
            return Ok(()); // Already running
        }

        // If a backend is already listening on the sidecar port (e.g. a
        // `run_backend.py` started from source during development), don't
        // spawn the bundled binary on top of it — that stale binary would
        // win the port and mask source changes.
        if std::net::TcpStream::connect(("127.0.0.1", 22140)).is_ok() {
            eprintln!("Backend already listening on 127.0.0.1:22140 — skipping bundled sidecar.");
            return Ok(());
        }

        let (_rx, child) = app
            .shell()
            .sidecar("backend")
            .map_err(|e| format!("Failed to create sidecar command: {e}"))?
            .spawn()
            .map_err(|e| format!("Failed to spawn backend sidecar: {e}"))?;

        *proc = Some(child);
        Ok(())
    }

    /// Kill the backend process.
    pub fn kill(&self) {
        if let Ok(mut proc) = self.process.lock() {
            if let Some(child) = proc.take() {
                let _ = child.kill();
            }
        }
    }
}

impl Drop for SidecarState {
    fn drop(&mut self) {
        self.kill();
    }
}
