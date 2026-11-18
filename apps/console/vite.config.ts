import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, the console talks to the server started by `pnpm dev:server`.
    proxy: { "/api": "http://localhost:8787" }
  }
})
