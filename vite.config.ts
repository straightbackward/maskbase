import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: [
      // Use pdfjs-dist's legacy build so the PDF viewer runs on older WebKit
      // (macOS Ventura's system WKWebView, which lacks Promise.withResolvers,
      // URL.parse, and other ES2024 / Safari 17.4+ APIs).
      { find: /^pdfjs-dist$/, replacement: "pdfjs-dist/legacy/build/pdf.mjs" },
    ],
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
