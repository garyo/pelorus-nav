/**
 * User-facing connection conditions emitted by GPS providers, mapped to
 * persistent status banners by main.ts. Generic across providers — only the
 * BLE providers emit the bt-* kinds. A silent GPS failure on the water is a
 * navigation hazard, so anything that stops fixes must surface here.
 */
export type ProviderNotice =
  | { kind: "bt-off" }
  | { kind: "bt-on" }
  | { kind: "connected" }
  | { kind: "picker-cancelled"; detail: string }
  | { kind: "connect-failed"; detail: string };
