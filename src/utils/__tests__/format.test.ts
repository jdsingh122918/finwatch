import { describe, it, expect } from "vitest";
import { formatPrice, formatVolume, formatChange, getChangeColor } from "../format.js";

describe("formatPrice", () => {
  it("formats whole dollar amounts", () => {
    expect(formatPrice(150)).toBe("$150.00");
  });

  it("formats cents correctly", () => {
    expect(formatPrice(150.5)).toBe("$150.50");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatPrice(150.456)).toBe("$150.46");
  });

  it("adds comma separators for thousands", () => {
    expect(formatPrice(1234.56)).toBe("$1,234.56");
  });

  it("handles zero", () => {
    expect(formatPrice(0)).toBe("$0.00");
  });

  it("handles large prices", () => {
    expect(formatPrice(123456.78)).toBe("$123,456.78");
  });
});

describe("formatVolume", () => {
  it("formats millions with M suffix", () => {
    expect(formatVolume(1000000)).toBe("1.00M");
  });

  it("formats thousands with K suffix", () => {
    expect(formatVolume(1500)).toBe("1.50K");
  });

  it("formats billions with B suffix", () => {
    expect(formatVolume(2500000000)).toBe("2.50B");
  });

  it("formats small numbers as-is", () => {
    expect(formatVolume(500)).toBe("500");
  });

  it("handles zero", () => {
    expect(formatVolume(0)).toBe("0");
  });

  it("formats partial millions", () => {
    expect(formatVolume(1234567)).toBe("1.23M");
  });
});

describe("formatChange", () => {
  it("formats positive change with + prefix and %", () => {
    expect(formatChange(5.25)).toBe("+5.25%");
  });

  it("formats negative change with - prefix and %", () => {
    expect(formatChange(-3.1)).toBe("-3.10%");
  });

  it("formats zero change", () => {
    expect(formatChange(0)).toBe("0.00%");
  });

  it("rounds to 2 decimal places", () => {
    expect(formatChange(1.999)).toBe("+2.00%");
  });
});

describe("getChangeColor", () => {
  it("returns accent color for positive values", () => {
    expect(getChangeColor(1)).toBe("text-accent");
  });

  it("returns severity-critical for negative values", () => {
    expect(getChangeColor(-1)).toBe("text-severity-critical");
  });

  it("returns text-muted for zero", () => {
    expect(getChangeColor(0)).toBe("text-text-muted");
  });
});
