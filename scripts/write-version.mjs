// Stamps the build with a fresh generated_at so every client's IndexedDB cache
// (DB name ehe-cache) invalidates on deploy and the UpdateBanner can prompt a
// reload. Runs after `vite build`, writing into dist/.
import { writeFileSync } from 'node:fs'

const stamp = new Date().toISOString()
const payload = JSON.stringify({ generated_at: stamp }) + '\n'
writeFileSync('dist/version.json', payload)
console.log(`wrote dist/version.json (generated_at ${stamp})`)
