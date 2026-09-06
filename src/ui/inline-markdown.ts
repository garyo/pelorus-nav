/**
 * The little Markdown the changelog uses inside a line — **bold**, *italic*,
 * `code`, [links](url) — rendered as DOM nodes for the What's New dialog.
 * Anything else stays literal text.
 */

const TOKEN =
  /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;

export function renderInlineMarkdown(text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [token, , url] = match;
    const at = match.index ?? 0;
    if (at > last) frag.append(text.slice(last, at));
    frag.append(renderToken(token, url));
    last = at + token.length;
  }
  if (last < text.length) frag.append(text.slice(last));
  return frag;
}

function renderToken(token: string, url: string | undefined): Node {
  if (token.startsWith("**")) {
    const el = document.createElement("strong");
    el.textContent = token.slice(2, -2);
    return el;
  }
  if (token.startsWith("`")) {
    const el = document.createElement("code");
    el.textContent = token.slice(1, -1);
    return el;
  }
  if (token.startsWith("[") && url) {
    const el = document.createElement("a");
    el.href = url;
    el.target = "_blank";
    el.rel = "noopener";
    el.textContent = token.slice(1, token.indexOf("]"));
    return el;
  }
  const el = document.createElement("em");
  el.textContent = token.slice(1, -1);
  return el;
}
