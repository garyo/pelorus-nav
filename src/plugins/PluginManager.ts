/**
 * Build-time plugin registry and loader.
 *
 * The single indirection through which all plugins are activated. Today it
 * activates a static list of compiled-in plugins (see `manifest.ts`); a later
 * phase can back the same registry with a runtime loader (fetch manifest →
 * capability prompt → dynamic import) without changing how plugins are written.
 */

import { type ActivePlugin, activatePlugin, type HostDeps } from "./host";
import { isApiCompatible, type Plugin } from "./types";

export class PluginManager {
  private readonly deps: HostDeps;
  private readonly plugins: Plugin[] = [];
  private readonly active: ActivePlugin[] = [];

  constructor(deps: HostDeps) {
    this.deps = deps;
  }

  /** Register a plugin. Rejected (with a warning) if its API major mismatches. */
  register(plugin: Plugin): void {
    const { id, apiVersion } = plugin.manifest;
    if (!isApiCompatible(apiVersion)) {
      console.warn(
        `Plugin "${id}" targets incompatible API ${apiVersion}; skipping`,
      );
      return;
    }
    if (this.plugins.some((p) => p.manifest.id === id)) {
      console.warn(`Plugin "${id}" already registered; skipping duplicate`);
      return;
    }
    this.plugins.push(plugin);
  }

  /** Activate all registered plugins in registration order. */
  activateAll(): void {
    for (const plugin of this.plugins) {
      try {
        this.active.push(activatePlugin(plugin, this.deps));
      } catch (err) {
        console.error(`Failed to activate plugin "${plugin.manifest.id}"`, err);
      }
    }
  }

  /** Tear down every active plugin (e.g. for tests / hot reload). */
  deactivateAll(): void {
    for (const a of this.active) a.deactivate();
    this.active.length = 0;
  }

  /** Ids of plugins that registered (passed the API-version gate). */
  registeredIds(): string[] {
    return this.plugins.map((p) => p.manifest.id);
  }

  /** Number of currently-active plugins. */
  get activeCount(): number {
    return this.active.length;
  }
}
