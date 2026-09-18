// Copies the pipeline's output into the app's public folder, where the viewer
// loads it from. The copy is generated, so it is ignored by git.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const source = new URL('../../out/comparison.json', import.meta.url);
const targetDir = new URL('../public/data/', import.meta.url);

if (!existsSync(source)) {
  console.warn('out/comparison.json does not exist yet. Run "npm start" in the repository root first.');
  console.warn('The viewer will start anyway and explain what is missing.');
  process.exit(0);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, new URL('comparison.json', targetDir));
console.log('Copied out/comparison.json into the viewer.');
