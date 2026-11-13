import { readFileSync } from 'node:fs';

/**
 * Read a secret the operator mounted as a file (a Docker secret, a Kubernetes Secret volume).
 * Its own module so tests replace the read instead of writing secrets to disk.
 */
export function readSecretFile(path: string): string {
  return readFileSync(path, 'utf8');
}
