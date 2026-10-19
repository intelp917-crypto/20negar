import fs from 'fs';
import path from 'path';
import { IFileStorage, FileStats } from './storage.interface.ts';
import { PRIVATE_VIDEOS_DIR, STORAGE_DIR } from '../config.ts';

/**
 * Keys are stored as `videos/<file>` even when the video folder lives on
 * another disk, so the `videos/` prefix is resolved against `videosDir`
 * instead of the general storage root. Every other key stays under the root.
 */
export class LocalFileStorage implements IFileStorage {
  private baseDir: string;
  private videosDir: string;

  constructor(baseDir: string = STORAGE_DIR, videosDir: string = '') {
    this.baseDir = path.resolve(baseDir);
    this.videosDir = path.resolve(videosDir || path.join(this.baseDir, 'videos'));
    for (const dir of new Set([this.baseDir, this.videosDir])) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  public getPhysicalPath(fileKey: string): string {
    if (!fileKey || path.isAbsolute(fileKey)) {
      throw new Error('Storage key must be a non-empty relative path.');
    }

    const normalised = fileKey.replace(/\\/g, '/');
    const segments = normalised.split('/').filter((segment) => segment && segment !== '.');
    const root = segments[0] === 'videos' ? this.videosDir : this.baseDir;
    const key = segments[0] === 'videos' ? segments.slice(1).join('/') : normalised;
    if (!key) {
      throw new Error('Storage key must point at a file, not a folder.');
    }

    const resolved = path.resolve(root, key);
    const relative = path.relative(root, resolved);
    if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Storage key escapes the configured storage root.');
    }

    return resolved;
  }

  public async saveFile(destinationKey: string, content: Buffer | Uint8Array): Promise<string> {
    const fullPath = this.getPhysicalPath(destinationKey);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.writeFile(fullPath, content);
    return destinationKey;
  }

  public async storeLocalFile(sourceTempPath: string, destinationKey: string): Promise<string> {
    const fullPath = this.getPhysicalPath(destinationKey);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    await fs.promises.copyFile(sourceTempPath, fullPath);
    // Cleanup temporary file if different
    if (sourceTempPath !== fullPath && fs.existsSync(sourceTempPath)) {
      try {
        await fs.promises.unlink(sourceTempPath);
      } catch (err) {
        // ignore unlink error
      }
    }
    return destinationKey;
  }

  public async exists(fileKey: string): Promise<boolean> {
    const fullPath = this.getPhysicalPath(fileKey);
    try {
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  public createReadStream(fileKey: string, range?: { start: number; end: number }): fs.ReadStream {
    const fullPath = this.getPhysicalPath(fileKey);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${fileKey}`);
    }
    return fs.createReadStream(fullPath, range ? { start: range.start, end: range.end } : {});
  }

  public async getFileStats(fileKey: string): Promise<FileStats> {
    const fullPath = this.getPhysicalPath(fileKey);
    const stats = await fs.promises.stat(fullPath);
    return {
      size: stats.size,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
    };
  }

  public async deleteFile(fileKey: string): Promise<void> {
    const fullPath = this.getPhysicalPath(fileKey);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }
}

export const fileStorage = new LocalFileStorage(STORAGE_DIR, PRIVATE_VIDEOS_DIR);
