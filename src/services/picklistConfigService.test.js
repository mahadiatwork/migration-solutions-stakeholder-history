import { getResultOptions } from "../components/organisms/helperFunc";
import { mandatoryCategoryOptions } from "../components/organisms/dialogConstants";
import {
  getDurationOptionsFromConfig,
  getResultMappingFromConfig,
  getTypeOptionsFromConfig,
} from "./picklistConfigService";

describe("mandatory Matter History picklists", () => {
  test("prepends the five categories even when CRM config is active", () => {
    const options = getTypeOptionsFromConfig({
      types: ["Meeting", "Other", "Custom Category"],
    });

    expect(options.slice(0, 5)).toEqual(mandatoryCategoryOptions);
    expect(options.filter((option) => option === "Other")).toHaveLength(1);
    expect(options).toContain("Custom Category");
  });

  test("uses the exact mandatory Category to Activity Type mapping", () => {
    const misleadingConfig = {
      results: {
        "Communication & Meetings": ["Configured override"],
      },
    };

    expect(
      getResultOptions("Communication & Meetings", misleadingConfig)
    ).toEqual(["Call", "Email", "Meeting", "Consultation"]);
    expect(getResultOptions("Technical casework", misleadingConfig)).toEqual([
      "Document Collection/Management",
      "Document Review",
      "Drafting/Preparation",
      "Review/Checking",
      "Amendments",
      "Lodgement/Submission",
      "RFI",
    ]);
  });

  test("keeps mandatory defaults while retaining configured legacy mappings", () => {
    const mapping = getResultMappingFromConfig({
      resultMapping: {
        "Communication & Meetings": "Configured override",
        Meeting: "Configured meeting result",
      },
    });

    expect(mapping["Communication & Meetings"]).toBe("Call");
    expect(mapping.Other).toBe("Training");
    expect(mapping.Meeting).toBe("Configured meeting result");
  });

  test("always provides zero through 240 in five-minute increments first", () => {
    const options = getDurationOptionsFromConfig({
      durations: ["5", "10", "60", "245"],
    });

    expect(options.slice(0, 49)).toEqual(
      Array.from({ length: 49 }, (_, index) => index * 5)
    );
    expect(options[0]).toBe(0);
    expect(options).toContain(245);
    expect(options.filter((value) => value === 5)).toHaveLength(1);
  });
});
