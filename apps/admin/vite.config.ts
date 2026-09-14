import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api/admin": "http://127.0.0.1:3001",
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
