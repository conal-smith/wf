import { describe, expect, it } from "vitest";
import { issuesByField, listingInputSchema } from "./validate";

/**
 * The sell form starts category, condition and county on "Choose…", so an
 * empty one is a seller who has not chosen yet. What the form shows under the
 * field is the schema's own message: it has to be one a person can act on,
 * not zod's list of every id it would have taken.
 */
describe("a listing with nothing chosen", () => {
  const fields = issuesByField(
    listingInputSchema.safeParse({
      title: "Maharees 5m wing, 2024",
      description: "Two seasons, no repairs, comes with the bag and leash.",
      category: "",
      condition: "",
      brand: null,
      sizeLabel: null,
      year: null,
      priceCents: 45000,
      currency: "EUR",
      county: "",
      town: null,
      photos: [],
    }).error!,
  );

  it("asks for each choice in words", () => {
    expect(fields.category).toBe("Choose what kind of gear this is");
    expect(fields.condition).toBe("Choose the condition it is in");
    expect(fields.county).toBe("Choose the county the gear is in");
  });
});
