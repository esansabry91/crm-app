import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Baked in at build time (changes only when the app is rebuilt/deployed, never at
    // request time) — used by DutyRosterPage.tsx to cache-bust the standalone duty-roster
    // iframe's src on every deploy, since that file is a plain copied static asset (not one
    // of Vite's own hashed, auto-versioned bundle files) loaded inside a long-lived iframe
    // that otherwise has no reason to ever re-fetch after the first load.
    __APP_BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
})
