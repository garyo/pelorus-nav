/**
 * PMTiles Source implementation backed by an OPFS File.
 *
 * This wraps a browser File object to implement the PMTiles Source interface,
 * providing the correct key so that Protocol.tilev4 can match URL requests
 * to the right source.
 *
 * Key detail: Protocol.tilev4 parses "pmtiles:///nautical.pmtiles/{z}/{x}/{y}"
 * and extracts "/nautical.pmtiles" as the lookup key. FileSource.getKey()
 * returns just "nautical.pmtiles" (no leading slash), so we need this wrapper
 * to return the correct key with the leading slash.
 */

import type { RangeResponse, Source } from "pmtiles";

export class OPFSSource implements Source {
  private file: File;
  private key: string;

  /**
   * @param file - OPFS File handle obtained via FileSystemFileHandle.getFile()
   * @param key - The key that Protocol will use to look up this source.
   *              Should match what Protocol extracts from the tile URL,
   *              e.g. "/nautical.pmtiles" for "pmtiles:///nautical.pmtiles/{z}/{x}/{y}"
   */
  constructor(file: File, key: string) {
    this.file = file;
    this.key = key;
  }

  getKey(): string {
    return this.key;
  }

  async getBytes(
    offset: number,
    length: number,
    _signal?: AbortSignal,
    _etag?: string,
  ): Promise<RangeResponse> {
    const slice = this.file.slice(offset, offset + length);
    const data = await slice.arrayBuffer();
    return { data };
  }
}
