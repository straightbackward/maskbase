// Manual update check against GitHub Releases. No background polling —
// the app only talks to GitHub when the user clicks "Check for updates".

export const APP_VERSION = '0.3.0';

export const GITHUB_REPO = 'straightbackward/maskbase';
export const GITHUB_URL = `https://github.com/${GITHUB_REPO}`;

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
  }
  return 0;
}

export async function checkForUpdate(): Promise<{
  available: boolean;
  version: string;
  downloadUrl: string;
} | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const version = String(data.tag_name || '').replace(/^v/, '');
    if (!version) return null;

    if (compareVersions(APP_VERSION, version) >= 0) {
      return { available: false, version, downloadUrl: '' };
    }

    const dmg = (data.assets || []).find((a: { name?: string }) => a.name?.endsWith('.dmg'));
    return {
      available: true,
      version,
      downloadUrl: dmg?.browser_download_url || data.html_url || GITHUB_URL,
    };
  } catch {
    return null;
  }
}
