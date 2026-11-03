import { describe, expect, it } from "vitest";
import { dayWords } from "./DaySteps";

describe("the day stepped to, in words", () => {
  // 19:59 on Tuesday 3 November 2026, Irish winter time.
  const now = Date.parse("2026-11-03T19:59:00Z");

  it("is Today and Tomorrow with their dates, then the weekday", () => {
    expect(dayWords("2026-11-03", now)).toEqual({
      name: "Today",
      date: "Tue 3 Nov",
    });
    expect(dayWords("2026-11-04", now)).toEqual({
      name: "Tomorrow",
      date: "Wed 4 Nov",
    });
    expect(dayWords("2026-11-05", now)).toEqual({
      name: "Thursday",
      date: "5 Nov",
    });
  });
});
