import { describe, expect, it } from "vitest";
import { endpointsFor, variantOf } from "./endpoints";

describe("variantOf", () => {
  it("reads the variant off the binary's identifier", () => {
    expect(variantOf("ie.wingfoil.app")).toBe("production");
    expect(variantOf("ie.wingfoil.app.staging")).toBe("staging");
    expect(variantOf("ie.wingfoil.app.dev")).toBe("development");
  });
  it("takes anything it does not know for production", () => {
    expect(variantOf(null)).toBe("production");
    expect(variantOf("host.exp.Exponent")).toBe("production");
  });
});

describe("endpointsFor", () => {
  it("reads production's forecast and API by default", () => {
    expect(endpointsFor("production", {})).toEqual({
      data: "https://data.wingfoil.ie/",
      site: "https://wingfoil.ie/",
      api: "https://api.wingfoil.ie/",
    });
  });
  it("gives staging its own API only when one is set", () => {
    expect(endpointsFor("staging", {}).api).toBe("https://api.wingfoil.ie/");
    expect(
      endpointsFor("staging", { EXPO_PUBLIC_STAGING_API_URL: "https://staging-api.example" }).api,
    ).toBe("https://staging-api.example/");
    expect(
      endpointsFor("production", { EXPO_PUBLIC_STAGING_API_URL: "https://staging-api.example" }).api,
    ).toBe("https://api.wingfoil.ie/");
  });
  it("keeps staging on production's forecast, as the staging site is", () => {
    expect(endpointsFor("staging", {}).data).toBe(endpointsFor("production", {}).data);
  });
});
