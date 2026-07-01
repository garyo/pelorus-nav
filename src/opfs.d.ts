// OPFS APIs used by the OPFS write worker (src/data/opfs-write-worker.ts) and
// tile-store.ts. Declared here because this project's TS DOM lib version
// doesn't yet include them. These augmentations merge with the built-in DOM
// types.

interface FileSystemSyncAccessHandle {
  read(
    buffer: ArrayBufferView | ArrayBuffer,
    options?: { at?: number },
  ): number;
  write(
    buffer: ArrayBufferView | ArrayBuffer,
    options?: { at?: number },
  ): number;
  truncate(newSize: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

interface FileSystemFileHandle {
  createSyncAccessHandle(): Promise<FileSystemSyncAccessHandle>;
}

interface FileSystemHandle {
  /**
   * Renames this entry within its parent directory. Optional because it
   * isn't in every OPFS implementation yet — callers must feature-detect and
   * fall back to copy+delete.
   */
  move?(newName: string): Promise<void>;
}

interface FileSystemDirectoryHandle {
  keys(): AsyncIterableIterator<string>;
}
