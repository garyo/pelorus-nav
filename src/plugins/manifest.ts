/**
 * Static list of build-time plugins, compiled into the bundle and tree-shaken
 * if unused. A future runtime loader registers additional plugins through the
 * same PluginManager.
 */

import { tidesPlugin } from "./tides";
import type { Plugin } from "./types";
import { weatherPlugin } from "./weather";

export const BUILTIN_PLUGINS: Plugin[] = [tidesPlugin, weatherPlugin];
