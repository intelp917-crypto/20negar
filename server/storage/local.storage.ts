import fs from 'fs';
import path from 'path';
import { IFileStorage, FileStats } from './storage.interface.ts';
import { STORAGE_DIR } from '../config.ts';

export class LocalFileStorage implements IFileStorage {
  private baseDir: string;

  constructor(baseDir: string = STORAGE_DIR) {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  public getPhysicalPath(fileKey: string): string {
    // Sanitize to prevent path traversal
    const safeKey = fileKey.replace(/^(\.\.[\/\\])+/, '').replace(/^[\\\/]+/, '');
    return path.resolve(this.baseDir, safeKey);
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

export const fileStorage = new LocalFileStorage();
