/**
 * Manages the active navigation provider and re-broadcasts data to subscribers.
 */

import type {
  NavigationData,
  NavigationDataCallback,
  NavigationDataProvider,
} from "./NavigationData";

export class NavigationDataManager {
  private providers: NavigationDataProvider[] = [];
  private activeProvider: NavigationDataProvider | null = null;
  private listeners: NavigationDataCallback[] = [];
  private lastData: NavigationData | null = null;

  private readonly onData: NavigationDataCallback = (data) => {
    this.lastData = data;
    for (const fn of this.listeners) {
      fn(data);
    }
  };

  registerProvider(provider: NavigationDataProvider): void {
    this.providers.push(provider);
  }

  getProviders(): readonly NavigationDataProvider[] {
    return this.providers;
  }

  getActiveProvider(): NavigationDataProvider | null {
    return this.activeProvider;
  }

  getLastData(): NavigationData | null {
    return this.lastData;
  }

  setActiveProvider(id: string): void {
    if (this.activeProvider) {
      this.activeProvider.unsubscribe(this.onData);
      this.activeProvider.disconnect();
    }

    this.lastData = null;
    const provider = this.providers.find((p) => p.id === id) ?? null;
    this.activeProvider = provider;

    if (provider) {
      provider.subscribe(this.onData);
      provider.connect();
    }
  }

  subscribe(callback: NavigationDataCallback): void {
    this.listeners.push(callback);
  }

  unsubscribe(callback: NavigationDataCallback): void {
    const idx = this.listeners.indexOf(callback);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  dispose(): void {
    if (this.activeProvider) {
      this.activeProvider.unsubscribe(this.onData);
      this.activeProvider.disconnect();
    }
    this.listeners.length = 0;
    this.lastData = null;
  }
}
