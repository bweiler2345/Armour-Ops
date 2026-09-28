import { describe, expect, it } from "vitest";
import { describeActivity } from "./activity";

const ID = "11111111-1111-4111-8111-111111111111";

describe("job history wording", () => {
  it("attributes each entry and names people mentioned", () => {
    expect(describeActivity({ type: "step_completed", actorName: "Sample Lead", details: { title: "Grind Floor" }, names: {} }).title).toBe(
      "Sample Lead completed “Grind Floor”",
    );
    expect(describeActivity({ type: "employee_added", actorName: "Sample Owner", details: { employee_id: ID, role: "lead" }, names: { [ID]: "Sample Member" } }).title).toBe(
      "Sample Owner added Sample Member as lead",
    );
    expect(describeActivity({ type: "status_changed", actorName: null, details: { to: "waiting_for_base_coat_installation" }, names: {} }).title).toBe(
      "Status changed to Waiting for Base-Coat Installation",
    );
  });

  it("shows reasons and field changes", () => {
    expect(describeActivity({ type: "step_reopened", actorName: "Sample Owner", details: { title: "Grind Floor", reason: "Missed a spot" }, names: {} })).toEqual({
      title: "Sample Owner reopened “Grind Floor”",
      changes: ["Reason: Missed a spot"],
    });
    expect(
      describeActivity({ type: "job_details_edited", actorName: "Sample Owner", details: { changes: { baseboard_required: { from: false, to: true } } }, names: {} })
        .changes,
    ).toEqual(["Baseboard: off → on"]);
  });

  it("never shows an unknown entry as blank", () => {
    expect(describeActivity({ type: "something_new", actorName: null, details: null, names: {} }).title).toBe("Someone updated the job");
  });
});
