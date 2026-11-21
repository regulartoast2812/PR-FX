#!/usr/bin/env node
/* Register Edie's unpacked UXP build without touching other installed plugins.
 * Premiere reads PluginsInfo at launch, so this never closes or restarts it. */
import { ensureUxpInstalled } from '../app/src/core.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const result = ensureUxpInstalled();
if (!result.ok) {
  console.error(result.message);
  process.exitCode = 1;
} else {
  // Premiere can keep the previous version loaded until it quits. Refresh the
  // UI/runtime files in older Edie folders too, so closing and reopening the
  // panel can pick up this build without forcing the editor to close now.
  const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'uxp');
  const parent = path.dirname(result.path);
  for (const name of fs.readdirSync(parent)) {
    const target = path.join(parent, name);
    if (!name.startsWith('com.prfx.edie_') || target === result.path) continue;
    for (const file of ['index.html', 'style.css', 'bridge.js', 'premiere.js', 'edie.png']) {
      fs.copyFileSync(path.join(source, file), path.join(target, file));
    }
  }
  console.log(`Installed Edie UXP ${result.version} at ${result.path}`);
  console.log('Premiere will load it on its next launch; the installer did not close Premiere.');
}
