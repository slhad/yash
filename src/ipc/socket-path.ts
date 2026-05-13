import * as path from 'node:path';
import { getDataDir } from '../utils/config';

export function resolveSocketPath(): string {
  return path.join(getDataDir(), 'yash.sock');
}
