import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DecisionJournal from "./DecisionJournal";

describe("DecisionJournal", () => {
  it("validates and submits a standalone decision note", () => {
    const onAdd = vi.fn();
    render(<DecisionJournal entries={[]} status="paused" onAdd={onAdd} />);

    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Write a note before adding it to the journal.",
    );

    fireEvent.change(screen.getByLabelText("Observation or decision note"), {
      target: { value: "  Wait for confirmation above resistance.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    expect(onAdd).toHaveBeenCalledWith(
      "Wait for confirmation above resistance.",
    );
    expect(screen.getByLabelText("Observation or decision note")).toHaveValue(
      "",
    );
  });

  it("locks note entry when the replay is complete", () => {
    render(<DecisionJournal entries={[]} status="finished" onAdd={vi.fn()} />);

    expect(screen.getByLabelText("Observation or decision note")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
  });
});
