import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri loads a fixed dev port; devUrl in src-tauri/tauri.conf.json must match.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
