// Separate from vite.config.ts on purpose: that file is managed by Lovable and
// pulls in the full app build. Tests only need plain TypeScript and the @ alias.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"] },
});
