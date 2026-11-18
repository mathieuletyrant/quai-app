import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react()],
  server: {
    // En dev, la console parle au serveur lancé par `pnpm dev:server`.
    proxy: { "/api": "http://localhost:8787" }
  }
})
