import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  test: { root: ".", exclude: ["**/node_modules/**", ".claude/**", "dist/**"] },
  build: { outDir: "../../dist/web", emptyOutDir: true },
});
