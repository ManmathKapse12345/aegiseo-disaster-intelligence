import { render, screen } from "@testing-library/react";
import { ApiError } from "@/api/client";
import { BarList, ContributionBars, PriorityDistribution, niceTicks } from "./charts";
import { ConfidenceMeter, ErrorState, PracticeChip, PriorityChip, StatusChip } from "./ui";

describe("chart scales", () => {
  it("produces clean ticks covering the maximum", () => {
    expect(niceTicks(87, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(0.84, 4)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});

describe("charts", () => {
  it("priority distribution exposes counts accessibly and has a legend", () => {
    render(<PriorityDistribution counts={{ Critical: 2, High: 3, Moderate: 0, Low: 5 }} />);
    expect(screen.getByRole("img", { name: /Critical 2, High 3, Low 5/ })).toBeInTheDocument();
    expect(screen.getAllByText("Low")).toHaveLength(2); // visible legend + screen-reader table
    expect(screen.queryAllByText("Moderate")).toHaveLength(0); // empty parts draw nothing
  });
  it("contribution bars label every factor", () => {
    render(<ContributionBars labels={{ a: "Extent", b: "Population" }} colors={{ a: "red", b: "blue" }}
      groups={[{ name: "Hazard", subscore: 80, parts: [{ key: "a", value: 0.8 }] }, { name: "Exposure", subscore: 40, parts: [{ key: "b", value: 0.4 }] }]} />);
    expect(screen.getByLabelText("Extent: 80 points")).toBeInTheDocument();
    expect(screen.getByText("80/100")).toBeInTheDocument();
  });
  it("bar list shows values as text, not colour only", () => {
    render(<BarList items={[{ label: "Cropland", value: 412.7 }]} unit=" ha" />);
    expect(screen.getByText("413 ha")).toBeInTheDocument();
  });
});

describe("ui", () => {
  it("status and priority chips use plain words", () => {
    render(<><StatusChip status="needs_review" /><PriorityChip category="Critical" override /><PracticeChip /></>);
    expect(screen.getByText("Needs a person to check")).toBeInTheDocument();
    expect(screen.getByText("Critical")).toBeInTheDocument();
    expect(screen.getByText("(changed by a person)")).toBeInTheDocument();
    expect(screen.getByText("Practice data")).toBeInTheDocument();
  });
  it("confidence is explained, not just labelled", () => {
    render(<ConfidenceMeter level="Low" />);
    expect(screen.getByRole("group", { name: "How sure we are: Low" })).toHaveTextContent(/first guess/);
  });
  it("error state turns API errors into actionable text", () => {
    render(<ErrorState error={new ApiError("invalid request", 422, [{ field: "hazard", message: "unsupported" }])} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Some choices need fixing: Type of disaster - unsupported.");
  });
});
