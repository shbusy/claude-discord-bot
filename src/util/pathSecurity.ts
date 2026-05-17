import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export function resolveWithinRoot(inputPath: string | undefined | null, rootPath: string): string {
  const root = resolve(rootPath);
  const target = inputPath && inputPath.length > 0
    ? isAbsolute(inputPath) ? resolve(inputPath) : resolve(root, inputPath)
    : root;
  if (!isPathInsideRoot(target, root)) {
    throw new Error(`허용된 작업 디렉토리 밖의 경로입니다: ${target}`);
  }
  return target;
}

export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const root = resolve(rootPath);
  const target = resolve(targetPath);
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && rel !== '..' && !isAbsolute(rel));
}

export function assertRealPathInsideRoot(targetPath: string, rootPath: string): void {
  const realRoot = realpathSync(resolve(rootPath));
  const realTarget = realpathSync(resolve(targetPath));
  if (!isPathInsideRoot(realTarget, realRoot)) {
    throw new Error(`허용된 작업 디렉토리 밖의 실제 경로입니다: ${realTarget}`);
  }
}
