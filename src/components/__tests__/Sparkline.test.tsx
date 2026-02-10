import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Sparkline } from "../Sparkline.js";

describe("Sparkline", () => {
  it("renders an SVG element", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders a polyline with data points", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline).toBeTruthy();
    expect(polyline?.getAttribute("points")).toBeTruthy();
  });

  it("uses default accent color", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline?.getAttribute("stroke")).toBe("#00ff88");
  });

  it("accepts custom color", () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} color="#ff0000" />);
    const polyline = container.querySelector("polyline");
    expect(polyline?.getAttribute("stroke")).toBe("#ff0000");
  });

  it("renders nothing when data is empty", () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelector("polyline")).toBeNull();
  });

  it("handles single data point", () => {
    const { container } = render(<Sparkline data={[5]} />);
    const polyline = container.querySelector("polyline");
    expect(polyline).toBeTruthy();
  });

  it("respects width and height props", () => {
    const { container } = render(<Sparkline data={[1, 2]} width={100} height={30} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("100");
    expect(svg?.getAttribute("height")).toBe("30");
  });
});
