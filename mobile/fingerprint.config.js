/**
 * What makes two builds able to run the same over-the-air update.
 *
 * The runtime version is this fingerprint (app.config.ts). The staging and
 * production apps differ only in name, identifier, scheme and icon, so those
 * are left out: one update, built once at nightly, then runs on both, which is
 * how the release train stages and promotes it byte for byte (docs/MOBILE.md).
 * The major version is put back in, as t3code does (apps/mobile there), so an
 * update from main never reaches a binary of an older major with the same
 * native code.
 *
 * @type {import('@expo/fingerprint').Config}
 */
const { SourceSkips } = require("@expo/fingerprint");
const { version } = require("./package.json");

module.exports = {
  sourceSkips:
    SourceSkips.ExpoConfigVersions |
    SourceSkips.ExpoConfigNames |
    SourceSkips.ExpoConfigAndroidPackage |
    SourceSkips.ExpoConfigIosBundleIdentifier |
    SourceSkips.ExpoConfigSchemes |
    SourceSkips.ExpoConfigAssets |
    SourceSkips.ExpoConfigEASProject |
    SourceSkips.ExpoConfigExtraSection |
    SourceSkips.PackageJsonScriptsAll |
    SourceSkips.GitIgnore,
  extraSources: [
    {
      type: "contents",
      id: "appMajorVersion",
      contents: String(version).split(".")[0],
    },
  ],
};
