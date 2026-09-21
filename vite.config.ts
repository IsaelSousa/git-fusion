import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri espera uma porta fixa e não quer que o Vite limpe o terminal.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
