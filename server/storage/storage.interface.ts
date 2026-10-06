import fs from 'fs';

export interface FileStats {
  size: number;
  createdAt: Date;
  modifiedAt: Date;
}

export interface IFileStorage {
  /**
   * Save a buffer or stream to storage at destinationKey
   */
  saveFile(destinationKey: string, content: Buffer | Uint8Array): Promise<string>;
  
  /**
   * Copy or move an existing temporary file to destinationKey
   */
  storeLocalFile(sourceTempPath: string, destinationKey: string): Promise<string>;
  
  /**
   * Get an absolute local filesystem path if available, or null
   */
  getPhysicalPath(fileKey: string): string;

  /**
   * Check if file exists in storage
   */
  exists(fileKey: string): Promise<boolean>;

  /**
   * Create a readable stream with optional range support for video streaming
   */
  createReadStream(fileKey: string, range?: { start: number; end: number }): fs.ReadStream;

  /**
   * Get metadata / stats about a file
   */
  getFileStats(fileKey: string): Promise<FileStats>;

  /**
   * Delete a file from storage
   */
  deleteFile(fileKey: string): Promise<void>;
}
