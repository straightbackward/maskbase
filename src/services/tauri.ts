import { invoke } from '@tauri-apps/api/core';

export async function openFileDialog(): Promise<string | null> {
  try {
    return await invoke<string | null>('open_file_dialog');
  } catch {
    console.error('File dialog not available (running in browser?)');
    return null;
  }
}

export async function getSidecarPort(): Promise<number> {
  try {
    return await invoke<number>('get_sidecar_port');
  } catch {
    return 22140;
  }
}

export async function isTauriEnvironment(): Promise<boolean> {
  try {
    await invoke('get_sidecar_port');
    return true;
  } catch {
    return false;
  }
}

