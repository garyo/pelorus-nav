/**
 * Side-effect module: install global JS error capture. Imported FIRST in
 * main.ts so the capture is live before any other app module evaluates —
 * module-initialization crashes are exactly the ones worth recording.
 */

import { installGlobalErrorCapture } from "./errorLog";

installGlobalErrorCapture();
