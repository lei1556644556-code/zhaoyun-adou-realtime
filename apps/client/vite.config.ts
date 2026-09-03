import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  base: "./",
  server: { port: 5173, strictPort: true },
  build: {
    target: "es2022",
    // Preview artifacts retain maps for diagnosis. Public production assets do not
    // publish the multi-megabyte source map.
    sourcemap: mode !== "production",
  },
}));
