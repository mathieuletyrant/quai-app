import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In dev, the console talks to Quai Home started by `pnpm dev:home`, which relays the Cloud's routes.
    proxy: {
      "/api": "http://localhost:8788",
      "/console-api": "http://localhost:8788",
      "/home-api": "http://localhost:8788"
    }
  }
})
