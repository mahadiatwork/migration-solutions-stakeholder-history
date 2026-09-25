import {
  getRegardingOptions,
  getResultOptions,
} from "../components/organisms/helperFunc";
import {
  getDurationOptionsFromConfig,
  getResultMappingFromConfig,
  getTypeOptionsFromConfig,
  buildConfigFromReadResult,
  groupRecords,
} from "./picklistConfigService";

describe("Widget_Picklist_Config authority", () => {
  afterEach(() => {
    delete window.ZOHO;
  });

  test("uses an empty custom config after a successful read with no active rows", () => {
    expect(
      buildConfigFromReadResult({
        reached: true,
        records: [{ Name: "Inactive", Category: "Type", Active: false }],
      })
    ).toMatchObject({
      _source: "custom_module",
      types: [],
      results: {},
      regarding: {},
      durations: [],
    });
    expect(
      buildConfigFromReadResult({ reached: false, records: [] })._source
    ).toBe("fallback");
  });

  test("accepts History Type and History Result category aliases", () => {
    const config = groupRecords([
      {
        Name: "Configured Category",
        Category: "History Type",
        Parent_Type: "",
        Sort_Order: 1,
      },
      {
        Name: "Configured Activity",
        Category: "History Result",
        Parent_Type: "Configured Category",
        Sort_Order: 2,
      },
      {
        Name: "Configured Regarding",
        Category: "Regarding",
        Parent_Type: "Configured Category",
        Sort_Order: 3,
      },
      {
        Name: "45",
        Category: "Duration",
        Parent_Type: "",
        Sort_Order: 4,
      },
    ]);

    expect(config).toMatchObject({
      _source: "custom_module",
      types: ["Configured Category"],
      results: { "Configured Category": ["Configured Activity"] },
      regarding: { "Configured Category": ["Configured Regarding"] },
      durations: [45],
    });
  });

  test("uses custom-module type and duration rows without legacy merging", () => {
    const config = {
      _source: "custom_module",
      types: ["Configured Category"],
      durations: [45, 90],
    };

    expect(getTypeOptionsFromConfig(config)).toEqual(["Configured Category"]);
    expect(getDurationOptionsFromConfig(config)).toEqual([45, 90]);
    expect(
      getTypeOptionsFromConfig({ _source: "custom_module", types: [] })
    ).toEqual([]);
    expect(
      getDurationOptionsFromConfig({
        _source: "custom_module",
        durations: [],
      })
    ).toEqual([]);
  });

  test("uses exact result parent, then _default, otherwise an empty list", () => {
    const config = {
      _source: "custom_module",
      results: {
        "Communication & Meetings": ["Configured override"],
        _default: ["Configured default"],
      },
    };

    expect(getResultOptions("Communication & Meetings", config)).toEqual([
      "Configured override",
    ]);
    expect(getResultOptions("Unmapped", config)).toEqual([
      "Configured default",
    ]);
    expect(
      getResultOptions("Unmapped", {
        _source: "custom_module",
        results: {},
      })
    ).toEqual([]);
  });

  test("uses exact regarding parent and preserves legacy values only on edit", () => {
    const config = {
      _source: "custom_module",
      regarding: { Call: ["Configured regarding"] },
    };

    expect(getRegardingOptions("Call", "", config)).toEqual([
      "Configured regarding",
    ]);
    expect(getRegardingOptions("Unmapped", "Legacy", config)).toEqual([]);
    expect(
      getRegardingOptions("Unmapped", "Legacy", config, true)
    ).toEqual(["Legacy"]);
  });

  test("does not add legacy result mappings to custom-module data", () => {
    expect(
      getResultMappingFromConfig({
        _source: "custom_module",
        resultMapping: { Custom: "Configured result" },
      })
    ).toEqual({ Custom: "Configured result" });
  });

  test("retains compatibility defaults only for the fallback source", () => {
    const fallback = { _source: "fallback" };

    expect(getTypeOptionsFromConfig(fallback)).toContain("Meeting");
    expect(getDurationOptionsFromConfig(fallback)).toContain(60);
    expect(getResultOptions("Meeting", fallback)).toEqual([
      "Meeting Held",
      "Meeting Not Held",
    ]);
    expect(getRegardingOptions("Meeting", "", fallback)).toContain(
      "Hourly Consult $220"
    );
  });

  test("retries the internal module name after a nested SDK error", async () => {
    jest.resetModules();
    const getAllRecords = jest.fn(({ Entity }) =>
      Entity === "Widget_Picklist_Config"
        ? Promise.resolve({
            data: [{ code: "INVALID_MODULE", status: "error" }],
          })
        : Promise.resolve({
            data: [
              {
                Name: "Alias Type",
                Category: "Type",
                Active: true,
              },
            ],
          })
    );
    window.ZOHO = { CRM: { API: { getAllRecords } } };
    const service = require("./picklistConfigService");

    const config = await service.fetchPicklistConfig();

    expect(config).toMatchObject({
      _source: "custom_module",
      types: ["Alias Type"],
    });
    expect(getAllRecords.mock.calls.map(([request]) => request.Entity)).toEqual([
      "Widget_Picklist_Config",
      "CustomModule15",
    ]);
  });

  test("does not cache a malformed SDK response as authoritative empty", async () => {
    jest.resetModules();
    const getAllRecords = jest.fn().mockResolvedValue(undefined);
    window.ZOHO = { CRM: { API: { getAllRecords } } };
    const service = require("./picklistConfigService");

    const config = await service.fetchPicklistConfig();

    expect(config._source).toBe("fallback");
    expect(getAllRecords).toHaveBeenCalledTimes(2);
  });

  test("treats SDK NO_DATA with an error status as authoritative empty", async () => {
    jest.resetModules();
    const getAllRecords = jest
      .fn()
      .mockResolvedValue({ code: "NO_DATA", status: "error" });
    window.ZOHO = { CRM: { API: { getAllRecords } } };
    const service = require("./picklistConfigService");

    const config = await service.fetchPicklistConfig();

    expect(config).toMatchObject({ _source: "custom_module", types: [] });
    expect(getAllRecords).toHaveBeenCalledTimes(1);
  });

  test("treats COQL NO_CONTENT with an error status as authoritative empty", async () => {
    jest.resetModules();
    const invoke = jest.fn().mockResolvedValue({
      details: {
        statusMessage: JSON.stringify({
          code: "NO_CONTENT",
          status: "error",
        }),
      },
    });
    window.ZOHO = { CRM: { API: {}, CONNECTION: { invoke } } };
    const service = require("./picklistConfigService");

    const config = await service.fetchPicklistConfig();

    expect(config).toMatchObject({ _source: "custom_module", types: [] });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("does not let an empty COQL status message mask an outer data error", async () => {
    jest.resetModules();
    const invoke = jest.fn((_connectionName, { parameters }) =>
      parameters.select_query.includes("Widget_Picklist_Config")
        ? Promise.resolve({
            data: { code: "INTERNAL_ERROR", status: "error" },
            details: {
              statusMessage: JSON.stringify({ data: [] }),
            },
          })
        : Promise.resolve({
            details: {
              statusMessage: JSON.stringify({
                data: [
                  {
                    Name: "Alias Type",
                    Category: "Type",
                    Active: true,
                  },
                ],
              }),
            },
          })
    );
    window.ZOHO = { CRM: { API: {}, CONNECTION: { invoke } } };
    const service = require("./picklistConfigService");

    const config = await service.fetchPicklistConfig();

    expect(config).toMatchObject({
      _source: "custom_module",
      types: ["Alias Type"],
    });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  test("reads every SDK page even when pages are short and exceed ten", async () => {
    jest.resetModules();
    const getAllRecords = jest.fn(({ page }) =>
      Promise.resolve({
        data: [
          {
            Name: `Configured ${page}`,
            Category: "Type",
            Sort_Order: page,
            Active: true,
          },
        ],
        info: { more_records: page < 12 },
      })
    );
    window.ZOHO = { CRM: { API: { getAllRecords } } };
    const service = require("./picklistConfigService");

    const config = await service.fetchPicklistConfig();

    expect(getAllRecords).toHaveBeenCalledTimes(12);
    expect(config.types).toHaveLength(12);
    expect(config.types[11]).toBe("Configured 12");
  });

  test("paginates COQL beyond 2000 rows", async () => {
    jest.resetModules();
    const firstPage = Array.from({ length: 2000 }, (_, index) => ({
      Name: `Configured ${index}`,
      Category: "Type",
      Sort_Order: index,
      Active: true,
    }));
    const invoke = jest
      .fn()
      .mockResolvedValueOnce({
        details: {
          statusMessage: JSON.stringify({
            data: firstPage,
            info: { more_records: true },
          }),
        },
      })
      .mockResolvedValueOnce({
        details: {
          statusMessage: JSON.stringify({
            data: [
              {
                Name: "Configured 2000",
                Category: "Type",
                Sort_Order: 2000,
                Active: true,
              },
            ],
            info: { more_records: false },
          }),
        },
      });
    window.ZOHO = { CRM: { API: {}, CONNECTION: { invoke } } };
    const service = require("./picklistConfigService");

    const config = await service.fetchPicklistConfig();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke.mock.calls[1][1].parameters.select_query).toContain(
      "LIMIT 2000, 2000"
    );
    expect(config.types).toHaveLength(2001);
    expect(config.types[2000]).toBe("Configured 2000");
  });
});
