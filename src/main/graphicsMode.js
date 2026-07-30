import fs from 'node:fs';
import path from 'node:path';

const CONFIG_FILE_NAME = 'config.json';

export function getStoredSafeGraphicsPreference(userDataPath) {
  try {
    const configPath = path.join(userDataPath, CONFIG_FILE_NAME);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return config?.safeGraphics === true;
  } catch {
    return false;
  }
}
