import {
  CUSTOM_REGARDING_LABEL,
  CUSTOM_REGARDING_OPTION,
  getRegardingOptions,
  getPersistedRegardingValue,
  getResultOptions,
  resolveCreateHistoryDefaults,
} from "./helperFunc";

describe("custom Regarding values", () => {
  test("persists preset values unchanged", () => {
    expect(getPersistedRegardingValue("Visa")).toBe("Visa");
  });

  test("persists custom text instead of the UI-only Custom option", () => {
    expect(getPersistedRegardingValue(CUSTOM_REGARDING_OPTION)).toBe("");
    expect(
      getPersistedRegardingValue(CUSTOM_REGARDING_OPTION, "My own regarding")
    ).toBe("My own regarding");
  });

  test("filters reserved Custom values without removing configured Other", () => {
    const config = {
      _source: "custom_module",
      regarding: {
        Meeting: [
          CUSTOM_REGARDING_LABEL,
          CUSTOM_REGARDING_OPTION,
          "Other",
          "Visa",
        ],
      },
    };

    expect(getRegardingOptions("Meeting", "", config)).toEqual([
      "Other",
      "Visa",
    ]);
  });
});

describe("create history defaults", () => {
  test("uses the semantic type but leaves exact Result and Regarding options blank", () => {
    const config = {
      _source: "custom_module",
      types: ["Fruit", "Communication & Meetings"],
      results: {
        Fruit: ["Apple"],
        "Communication & Meetings": ["Apple"],
      },
      regarding: {
        Fruit: ["Pear"],
        "Communication & Meetings": ["Pear"],
      },
    };

    expect(resolveCreateHistoryDefaults(config.types)).toEqual({
      type: "Communication & Meetings",
      result: "",
      regarding: "",
    });
    expect(getResultOptions("Communication & Meetings", config)).toEqual([
      "Apple",
    ]);
    expect(
      getRegardingOptions("Communication & Meetings", "", config)
    ).toEqual(["Pear"]);
  });

  test("leaves dependent create fields blank when the canonical type is absent", () => {
    const config = {
      _source: "custom_module",
      types: ["Fruit"],
      results: { Fruit: ["Apple"], _default: ["Fallback result"] },
      regarding: { Fruit: ["Pear"], _default: ["Fallback regarding"] },
    };

    expect(resolveCreateHistoryDefaults(config.types)).toEqual({
      type: "",
      result: "",
      regarding: "",
    });
  });

  test("does not use unparented Result and Regarding options as defaults", () => {
    const config = {
      _source: "custom_module",
      types: ["Communication & Meetings"],
      results: { _default: ["Apple"] },
      regarding: { _default: ["Pear"] },
    };

    expect(resolveCreateHistoryDefaults(config.types)).toEqual({
      type: "Communication & Meetings",
      result: "",
      regarding: "",
    });
    expect(getResultOptions("Communication & Meetings", config)).toEqual([
      "Apple",
    ]);
    expect(
      getRegardingOptions("Communication & Meetings", "", config)
    ).toEqual(["Pear"]);
  });
});
