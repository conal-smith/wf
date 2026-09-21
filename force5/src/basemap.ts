/** What the map paints over the default basemap style, land and water. */
export type BasemapColours = { land: string; water: string };

/**
 * The two basemap colours, read off the theme instead of written down twice.
 *
 * `ui/theme.css` is `@theme static`, so every `--color-*` is emitted on
 * `:root` whether a utility class asks for it or not; src/main.tsx imports it
 * before it renders anything, and a build serves it as a stylesheet in the
 * head, so the values are on the document before the map is made.
 *
 * A host that embeds the published component without that import gets an empty
 * string back, and the caller then leaves the layer alone: a legible map in the
 * provider's own palette is a better answer than a hex copied into TS, which is
 * the one thing ui/theme.css exists to prevent.
 */
export function basemapColours(
  root: Pick<CSSStyleDeclaration, "getPropertyValue">,
): BasemapColours {
  const read = (name: string) => root.getPropertyValue(name).trim();
  return {
    land: read("--color-basemap-land"),
    water: read("--color-basemap-water"),
  };
}
