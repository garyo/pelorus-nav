/**
 * Static list of build-time plugins, compiled into the bundle and tree-shaken
 * if unused. A future runtime loader registers additional plugins through the
 * same PluginManager.
 */

import { tidesPlugin } from "./tides";
import type { Plugin } from "./types";
import { windPlugin } from "./wind";

// The OpenWeatherMap raster weather plugin (src/plugins/weather/) is kept in the
// tree but excluded from the build: its translucent color-wash tiles add little
// over the Open-Meteo wind barbs and aren't worth the API-key UX. Re-add
// `weatherPlugin` from "./weather" here to ship it again.
export const BUILTIN_PLUGINS: Plugin[] = [tidesPlugin, windPlugin];
