/**
 * Node resolve hook so the tests can import the application source unchanged.
 *
 * The app is bundled by Vite, which resolves extensionless imports
 * ("./messenger" -> "./messenger.js") and JSX. Node's ESM loader does not, so
 * this hook replays the same lookup rules. Test-only; nothing in the app
 * depends on it.
 */

import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const EXTENSIONS = ['.js', '.mjs', '.jsx', '.json']

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    // Only rescue relative imports that are missing an extension.
    if (!specifier.startsWith('.') || !context.parentURL) throw err

    const base = new URL(specifier, context.parentURL)
    const basePath = fileURLToPath(base)

    for (const ext of EXTENSIONS) {
      if (existsSync(basePath + ext)) {
        return nextResolve(pathToFileURL(basePath + ext).href, context)
      }
    }
    for (const ext of EXTENSIONS) {
      const indexPath = basePath.replace(/\/$/, '') + '/index' + ext
      if (existsSync(indexPath)) {
        return nextResolve(pathToFileURL(indexPath).href, context)
      }
    }
    throw err
  }
}
