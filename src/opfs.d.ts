// OPFS synchronous access handle, used by the OPFS write worker
// (src/data/opfs-write-worker.ts). Declared here because this project's TS DOM
// lib version doesn't yet include it. The FileSystemFileHandle augmentation
// merges with the built-in DOM type to add createSyncAccessHandle.

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
