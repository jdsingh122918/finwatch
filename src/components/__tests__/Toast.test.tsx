import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ToastContainer, useToast, ToastProvider } from "../Toast.js";

function TestConsumer({ message, type }: { message: string; type?: "success" | "error" | "info" }) {
  const toast = useToast();
  return (
    <button onClick={() => toast(message, type)}>trigger</button>
  );
}

function renderWithProvider(ui: React.ReactElement) {
  return render(
    <ToastProvider>
      {ui}
      <ToastContainer />
    </ToastProvider>,
  );
}

describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("renders nothing when no toasts", () => {
    renderWithProvider(<div />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a toast message when triggered", () => {
    renderWithProvider(<TestConsumer message="Saved!" />);
    act(() => {
      screen.getByText("trigger").click();
    });
    expect(screen.getByText("Saved!")).toBeTruthy();
  });

  it("applies success style by default", () => {
    renderWithProvider(<TestConsumer message="Done" />);
    act(() => {
      screen.getByText("trigger").click();
    });
    const toast = screen.getByText("Done").closest("[role=status]");
    expect(toast?.className).toContain("border-accent");
  });

  it("applies error style", () => {
    renderWithProvider(<TestConsumer message="Failed" type="error" />);
    act(() => {
      screen.getByText("trigger").click();
    });
    const toast = screen.getByText("Failed").closest("[role=status]");
    expect(toast?.className).toContain("border-severity-critical");
  });

  it("applies info style", () => {
    renderWithProvider(<TestConsumer message="Note" type="info" />);
    act(() => {
      screen.getByText("trigger").click();
    });
    const toast = screen.getByText("Note").closest("[role=status]");
    expect(toast?.className).toContain("border-text-muted");
  });

  it("auto-dismisses after timeout", () => {
    renderWithProvider(<TestConsumer message="Bye" />);
    act(() => {
      screen.getByText("trigger").click();
    });
    expect(screen.getByText("Bye")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText("Bye")).toBeNull();
  });

  it("can show multiple toasts", () => {
    renderWithProvider(<TestConsumer message="Toast1" />);
    act(() => {
      screen.getByText("trigger").click();
      screen.getByText("trigger").click();
    });
    const items = screen.getAllByRole("status");
    expect(items.length).toBe(2);
  });
});
