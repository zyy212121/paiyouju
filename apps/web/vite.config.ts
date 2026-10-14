import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const serverPort = process.env.WEPOKER_SERVER_PORT ?? "3000";
const serverHttpTarget = `http://127.0.0.1:${serverPort}`;
const serverWebSocketTarget = `ws://127.0.0.1:${serverPort}`;
const releaseVersion = "0.1.0-rc.1";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg", "icon-180.png", "icon-maskable.svg"],
      manifest: {
        name: "牌友局",
        short_name: "牌友局",
        description: "私人虚拟积分德州扑克平台",
        theme_color: "#071a18",
        background_color: "#071a18",
        display: "standalone",
        lang: "zh-CN",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icon-maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,wav,webmanifest}"],
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/socket\.io(?:\/|$)/, /^\/(?:health|ready)$/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
          {
            urlPattern: ({ request, url }) => url.origin === self.location.origin
              && ["font", "image", "script", "style"].includes(request.destination)
              && !url.pathname.startsWith("/api/")
              && !url.pathname.startsWith("/socket.io/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: `wepoker-public-static-${releaseVersion}`,
              expiration: { maxAgeSeconds: 7 * 24 * 60 * 60, maxEntries: 80 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    host: "localhost",
    port: 5_173,
    strictPort: true,
    proxy: {
      "/api": serverHttpTarget,
      "/health": serverHttpTarget,
      "/socket.io": {
        target: serverWebSocketTarget,
        ws: true,
      },
    },
  },
});
