import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import { sha256 } from './hashing.js';

export interface StoredFile {
  path: string;
  sha256: string;
  size: number;
}

export async function ensureStorageDir(): Promise<void> {
  await mkdir(config.storagePath, { recursive: true });
}

export async function storeFile(
  projectId: string,
  filename: string,
  content: Buffer
): Promise<StoredFile> {
  await ensureStorageDir();

  const fileId = nanoid();
  const ext = filename.split('.').pop() || 'bin';
  const storageName = `${fileId}.${ext}`;
  const projectDir = join(config.storagePath, projectId);
  await mkdir(projectDir, { recursive: true });

  const filePath = join(projectDir, storageName);
  await writeFile(filePath, content);

  return {
    path: filePath,
    sha256: sha256(content),
    size: content.length,
  };
}

export async function readStoredFile(path: string): Promise<Buffer> {
  return readFile(path);
}

export async function deleteStoredFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // File may not exist
  }
}

export function getRelativePath(fullPath: string): string {
  return fullPath.replace(config.storagePath, '').replace(/^\//, '');
}
