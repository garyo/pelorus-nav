/**
 * Browser file download and upload utilities.
 */

export const GPX_MIME = "application/gpx+xml";

/** Trigger a browser file download with the given content. */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Open a file picker and return the selected file's text content. */
export function pickFile(accept: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      document.body.removeChild(input);
      if (!file) {
        reject(new Error("No file selected"));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read file"));
      reader.readAsText(file);
    });

    // Handle cancel — the input fires no change event, so we listen for focus return
    const onFocus = () => {
      window.removeEventListener("focus", onFocus);
      // Delay to let the change event fire first if a file was selected
      setTimeout(() => {
        if (input.parentNode) {
          document.body.removeChild(input);
          reject(new Error("File selection cancelled"));
        }
      }, 300);
    };
    window.addEventListener("focus", onFocus);

    input.click();
  });
}

/** Replace characters that are invalid in filenames with underscores. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").trim() || "export";
}
