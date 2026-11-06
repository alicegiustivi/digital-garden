import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  test: { root: "." },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
