import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const resolvePath = (...args) => join(__dirname, ...args);
export const getRootPath = () => join(__dirname, '../../');