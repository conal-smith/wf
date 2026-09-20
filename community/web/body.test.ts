import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Member } from "../shared/types";
import { parseBody, parseInline, plainText, safeHref } from "./body";
import { Body } from "./components/Body";

/**
 * S7. A body is text with a small markdown subset, and never HTML (D18). The
 * tree is asked what it read; the markup is asked what reached the page, which
 * is the question that matters: whatever a member types, the only elements in
 * the result are the ones the renderer wrote itself.
 */

const aoife: Member = {
  id: "dev_aoife",
  handle: "aoife-k",
  displayName: "Aoife K",
  avatarUrl: null,
  role: "member",
};

const html = (body: string, mentions: Member[] = []) =>
  renderToStaticMarkup(createElement(Body, { body, mentions }));

/** Every element in the markup, by name. */
const elements = (markup: string) =>
  [...markup.matchAll(/<([a-z][a-z0-9]*)\b/gi)].map((m) => m[1]);

describe("what is not the subset is text", () => {
  it("a script tag renders as its own characters", () => {
    const markup = html("<script>alert(1)</script>");
    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(elements(markup)).toEqual(["div", "p"]);
  });

  it("raw HTML renders as text, attributes and all", () => {
    const markup = html(
      '<img src=x onerror="alert(1)"> <b>bold</b> <a href="https://example.com">x</a>',
    );
    expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(markup).toContain("&lt;b&gt;bold&lt;/b&gt;");
    // The address inside the typed tag is still an address, and the tag is not one.
    expect(elements(markup).filter((name) => name !== "a")).toEqual([
      "div",
      "p",
    ]);
    expect(markup).not.toMatch(/<img|<b>|onerror="/);
  });

  it.each([
    "[click me](javascript:alert(1))",
    "[click me](JaVaScRiPt:alert(1))",
    "[click me](data:text/html,<script>alert(1)</script>)",
    "[click me](vbscript:msgbox)",
    "[click me](//example.com)",
    "javascript:alert(1)",
  ])("%s makes no link", (body) => {
    const markup = html(body);
    expect(elements(markup)).not.toContain("a");
    expect(markup).not.toContain("href");
    // What was typed is still there to read, as typed.
    expect(markup).toContain(body.startsWith("[") ? "[click me](" : body);
  });

  it("an entity is not decoded into markup", () => {
    expect(html("&lt;script&gt; &#60;b&#62;")).toContain(
      "&amp;lt;script&amp;gt; &amp;#60;b&amp;#62;",
    );
  });

  it("markup inside emphasis, a list, a quote and a link label stays text", () => {
    const markup = html(
      [
        "**<i>one</i>**",
        "",
        "- <u>two</u>",
        "",
        "> <s>three</s>",
        "",
        "[<em>four</em>](https://example.com)",
      ].join("\n"),
    );
    expect(markup).toContain("&lt;i&gt;one&lt;/i&gt;");
    expect(markup).toContain("&lt;u&gt;two&lt;/u&gt;");
    expect(markup).toContain("&lt;s&gt;three&lt;/s&gt;");
    expect(markup).toContain("&lt;em&gt;four&lt;/em&gt;");
    expect(elements(markup).sort()).toEqual(
      ["a", "blockquote", "div", "li", "p", "p", "p", "strong", "ul"].sort(),
    );
  });

  it("never reaches for innerHTML", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("./components/Body.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
  });
});

describe("safeHref", () => {
  it("passes http and https, and nothing else", () => {
    expect(safeHref("https://wingfoil.ie/market")).toBe(
      "https://wingfoil.ie/market",
    );
    expect(safeHref("http://example.com")).toBe("http://example.com/");
    for (const bad of [
      "javascript:alert(1)",
      "ftp://example.com",
      "mailto:a@example.com",
      "//example.com",
      "example.com",
      "https://",
      " https://example.com",
    ])
      expect(safeHref(bad), bad).toBeNull();
  });
});

describe("links", () => {
  it("a labelled link carries rel nofollow noopener and opens apart", () => {
    const markup = html("[the forecast](https://wingfoil.ie/)");
    expect(markup).toMatch(
      /<a [^>]*href="https:\/\/wingfoil\.ie\/"[^>]*>the forecast<\/a>/,
    );
    expect(markup).toContain('rel="nofollow noopener"');
    expect(markup).toContain('target="_blank"');
  });

  it("a bare address is a link, without the sentence's own punctuation", () => {
    expect(parseInline("See https://example.com/a?b=1, then go.")).toEqual([
      { t: "text", text: "See " },
      {
        t: "link",
        href: "https://example.com/a?b=1",
        children: [{ t: "text", text: "https://example.com/a?b=1" }],
      },
      { t: "text", text: ", then go." },
    ]);
  });
});

describe("the subset", () => {
  it("bold and italic, by asterisk and by underscore", () => {
    expect(parseInline("a **b** *c* _d_ e")).toEqual([
      { t: "text", text: "a " },
      { t: "bold", children: [{ t: "text", text: "b" }] },
      { t: "text", text: " " },
      { t: "italic", children: [{ t: "text", text: "c" }] },
      { t: "text", text: " " },
      { t: "italic", children: [{ t: "text", text: "d" }] },
      { t: "text", text: " e" },
    ]);
    expect(html("**bold *and italic***")).toContain("<strong");
  });

  it("leaves arithmetic and snake_case alone", () => {
    expect(parseInline("5 * 6 * 7 and wing_foil_board")).toEqual([
      { t: "text", text: "5 * 6 * 7 and wing_foil_board" },
    ]);
  });

  it("blank lines part paragraphs and a single newline is a break", () => {
    expect(parseBody("one\ntwo\n\nthree")).toEqual([
      {
        t: "paragraph",
        children: [
          { t: "text", text: "one" },
          { t: "break" },
          { t: "text", text: "two" },
        ],
      },
      { t: "paragraph", children: [{ t: "text", text: "three" }] },
    ]);
  });

  it("lists, bulleted and numbered", () => {
    expect(parseBody("Kit:\n- wing\n- board\n\n1. pump\n2. go")).toEqual([
      { t: "paragraph", children: [{ t: "text", text: "Kit:" }] },
      {
        t: "list",
        ordered: false,
        items: [[{ t: "text", text: "wing" }], [{ t: "text", text: "board" }]],
      },
      {
        t: "list",
        ordered: true,
        items: [[{ t: "text", text: "pump" }], [{ t: "text", text: "go" }]],
      },
    ]);
    const markup = html("- wing\n- board");
    expect(markup).toMatch(/<ul[^>]*><li>wing<\/li><li>board<\/li><\/ul>/);
  });

  it("a quote holds paragraphs, and a quote inside it is its text", () => {
    expect(parseBody("> first\n> > second\nafter")).toEqual([
      {
        t: "quote",
        children: [
          {
            t: "paragraph",
            children: [
              { t: "text", text: "first" },
              { t: "break" },
              { t: "text", text: "> second" },
            ],
          },
        ],
      },
      { t: "paragraph", children: [{ t: "text", text: "after" }] },
    ]);
  });
});

describe("mentions", () => {
  it("a stored token draws as a chip with the member's name", () => {
    const markup = html("Not cowardly at all, <@dev_aoife>.", [aoife]);
    expect(markup).toMatch(/<span class="[^"]+">@Aoife K<\/span>\./);
    expect(markup).not.toContain("dev_aoife");
  });

  it("a token the message names nobody for is still a mention, never markup", () => {
    const markup = html("<@ghost>");
    expect(markup).toContain("@member");
    expect(markup).not.toContain("ghost");
  });

  it("plainText gives the words of a line, for an excerpt", () => {
    expect(
      plainText(
        parseInline("**Agree**, <@dev_aoife>: see [this](https://a.ie)"),
        () => "@Aoife K",
      ),
    ).toBe("Agree, @Aoife K: see this");
  });
});
