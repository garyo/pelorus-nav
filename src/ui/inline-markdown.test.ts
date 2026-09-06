// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderInlineMarkdown } from "./inline-markdown";

const html = (text: string) => {
  const div = document.createElement("div");
  div.append(renderInlineMarkdown(text));
  return div.innerHTML;
};

describe("renderInlineMarkdown", () => {
  it("renders bold, italic, code and links, leaving the rest as text", () => {
    expect(
      html(
        "**TIDE** in the *top bar* shows `x` — see [the guide](https://pelorus-nav.com/doc/userguide/).",
      ),
    ).toBe(
      '<strong>TIDE</strong> in the <em>top bar</em> shows <code>x</code> — see <a href="https://pelorus-nav.com/doc/userguide/" target="_blank" rel="noopener">the guide</a>.',
    );
  });

  it("does not turn text into markup", () => {
    expect(html("a < b & **<script>**")).toBe(
      "a &lt; b &amp; <strong>&lt;script&gt;</strong>",
    );
  });

  it("leaves lone asterisks and non-http links alone", () => {
    expect(html("5 * 3 and [x](javascript:alert(1))")).toBe(
      "5 * 3 and [x](javascript:alert(1))",
    );
  });
});
