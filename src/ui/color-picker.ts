/**
 * Shared helper for the hidden `<input type="color">` swatches used by the
 * route/track manager panels. Native color inputs fire no `change` event
 * when the user cancels the picker, so cleanup can't live in the `change`
 * handler alone — that leaks one hidden input per cancelled pick. This
 * cleans up on `blur` too, which fires whether the pick was committed or
 * cancelled.
 */
export function openColorPicker(
  anchor: HTMLElement,
  initial: string,
  onPreview: (color: string) => void,
  onPick: (color: string) => void,
): void {
  const input = document.createElement("input");
  input.type = "color";
  input.value = initial;
  input.style.position = "absolute";
  input.style.opacity = "0";
  anchor.appendChild(input);

  const cleanup = () => input.remove();

  input.addEventListener("input", () => onPreview(input.value));
  input.addEventListener("change", () => onPick(input.value));
  // Runs after `change` on a committed pick (harmless double-cleanup) and
  // is the only cleanup that fires on a cancelled pick.
  input.addEventListener("blur", cleanup);

  input.click();
}
