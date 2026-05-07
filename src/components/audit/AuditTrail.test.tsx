import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AuditTrail from "./AuditTrail";
import type { AuditEvent } from "../../types";

const events: AuditEvent[] = [
  {
    id: "aud_1",
    time: "2020-01-02T00:00:00.000Z",
    type: "order_placed",
    message: "Market buy order placed.",
    orderId: "ord_1",
    symbol: "BTCUSD",
  },
  {
    id: "aud_2",
    time: "2020-01-03T00:00:00.000Z",
    type: "fill",
    message: "buy 0.05 BTCUSD filled at 7200.",
    orderId: "ord_1",
    fillId: "fil_1",
    symbol: "BTCUSD",
  },
  {
    id: "aud_3",
    time: "2020-01-04T00:00:00.000Z",
    type: "forced_liquidation",
    message: "Liquidation threshold breached; positions were closed.",
  },
];

describe("AuditTrail", () => {
  it("renders newest audit events first with typed labels", () => {
    render(<AuditTrail events={events} />);

    const trail = within(screen.getByLabelText("Replay audit trail"));
    const items = trail.getAllByRole("article");
    expect(items).toHaveLength(3);
    expect(within(items[0]).getByText("Liquidation")).toBeInTheDocument();
    expect(within(items[1]).getByText("Fill")).toBeInTheDocument();
    expect(within(items[1]).getByText("fil_1")).toBeInTheDocument();
  });

  it("shows an empty state before auditable actions happen", () => {
    render(<AuditTrail events={[]} />);

    expect(screen.getByText(/Replay audit events will appear/i)).toBeInTheDocument();
  });
});
