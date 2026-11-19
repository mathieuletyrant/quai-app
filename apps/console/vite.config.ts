import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In dev, the console talks to the server started by `pnpm dev:cloud`.
    proxy: { "/api": "http://localhost:8787", "/console-api": "http://localhost:8787" }
  }
})
