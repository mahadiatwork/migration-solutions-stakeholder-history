import {
  BILLING_TYPE_OPTIONS,
  buildMatterFormSnapshot,
  extractMatterDependencyMap,
  extractMatterMetadataFromLayout,
  fetchLatestMatterForStakeholder,
  getAllowedMatterProgressOptions,
  hydrateMatterRecord,
  resolveMatterProgressForStage,
  selectMostRecentlyModifiedMatter,
} from "./matterHistoryService";

describe("matterHistoryService", () => {
  test("selects the most recently modified stakeholder matter", () => {
    const selected = selectMostRecentlyModifiedMatter([
      { id: "old", Modified_Time: "2026-01-01T00:00:00Z" },
      { id: "new", Modified_Time: "2026-02-01T00:00:00Z" },
    ]);

    expect(selected.id).toBe("new");
  });

  test("builds the History1 form snapshot and preserves a zero-free default", () => {
    const snapshot = buildMatterFormSnapshot({
      id: "matter-1",
      Name: "MAT-001",
      Current_Stage: "Assessment",
      Matter_Progress: [{ actual_value: "Evidence review" }],
      Modified_Time: "2026-02-01T00:00:00Z",
      Layout: { id: "layout-1" },
    });

    expect(snapshot).toEqual({
      matter: {
        id: "matter-1",
        name: "MAT-001",
        layoutId: "layout-1",
      },
      matterNo: "MAT-001",
      currentStage: "Assessment",
      matterProgress: "Evidence review",
      billingType: BILLING_TYPE_OPTIONS[0],
    });
  });

  test("hydrates a related-list matter before using its layout", async () => {
    const relatedMatter = {
      id: "matter-1",
      Name: "MAT-001",
      Current_Stage: "Assessment",
    };
    const api = {
      getRecord: jest.fn().mockResolvedValue({
        data: [
          {
            id: "matter-1",
            Current_Stage: "Preparation",
            Layout: { id: "layout-2" },
          },
        ],
      }),
    };

    await expect(hydrateMatterRecord(relatedMatter, api)).resolves.toEqual({
      ...relatedMatter,
      Current_Stage: "Preparation",
      Layout: { id: "layout-2" },
    });
    expect(api.getRecord).toHaveBeenCalledWith({
      Entity: "Applications",
      RecordID: "matter-1",
      approved: "both",
    });
  });

  test("requests timestamps, selects the latest matter, and hydrates it", async () => {
    const api = {
      getRelatedRecords: jest.fn().mockResolvedValue({
        data: [
          { id: "matter-old", Modified_Time: "2026-01-01T00:00:00Z" },
          { id: "matter-new", Modified_Time: "2026-02-01T00:00:00Z" },
        ],
      }),
      getRecord: jest.fn().mockResolvedValue({
        data: [{ id: "matter-new", Layout: { id: "layout-new" } }],
      }),
    };

    await expect(
      fetchLatestMatterForStakeholder("stakeholder-1", api)
    ).resolves.toMatchObject({
      id: "matter-new",
      Layout: { id: "layout-new" },
    });
    expect(api.getRelatedRecords).toHaveBeenCalledWith({
      Entity: "Accounts",
      RecordID: "stakeholder-1",
      RelatedList: "Applications",
      page: 1,
      per_page: 200,
      fields:
        "id,Name,Current_Stage,Matter_Progress,Modified_Time,Created_Time",
    });
    expect(api.getRecord).toHaveBeenCalledWith({
      Entity: "Applications",
      RecordID: "matter-new",
      approved: "both",
    });
  });

  test("reads active picklists and embedded stage dependencies from a layout", () => {
    const metadata = extractMatterMetadataFromLayout({
      id: "layout-1",
      sections: [
        {
          fields: [
            {
              api_name: "Current_Stage",
              pick_list_values: [
                {
                  actual_value: "Assessment",
                  maps: [
                    { actual_value: "Evidence review" },
                    { actual_value: "Unused progress", type: "unused" },
                    { actual_value: "Inactive progress", active: false },
                    { actual_value: "Deleted progress", _delete: null },
                  ],
                },
                { actual_value: "Unused stage", type: "unused" },
                { actual_value: "Inactive stage", type: "inactive" },
                { actual_value: "Disabled stage", active: false },
                { actual_value: "Deleted stage", _delete: null },
              ],
            },
            {
              api_name: "Matter_Progress",
              pick_list_values: [
                { actual_value: "Evidence review" },
                { actual_value: "Drafting" },
                { actual_value: "Unused progress", type: "unused" },
                { actual_value: "Inactive progress", type: "inactive" },
                { actual_value: "Disabled progress", active: false },
                { actual_value: "Deleted progress", _delete: null },
              ],
            },
          ],
        },
      ],
    });

    expect(metadata.stageOptions).toEqual(["Assessment"]);
    expect(metadata.progressOptions).toEqual(["Evidence review", "Drafting"]);
    expect(metadata.progressByStage).toEqual({
      Assessment: ["Evidence review"],
    });
  });

  test("parses v8 map-dependency details", () => {
    const map = extractMatterDependencyMap([
      {
        parent: { api_name: "Current_Stage" },
        child: { api_name: "Matter_Progress" },
        active: false,
        pick_list_values: [
          {
            actual_value: "Preparation",
            maps: [{ actual_value: "Disabled mapping" }],
          },
        ],
      },
      {
        parent: { api_name: "Current_Stage" },
        child: { api_name: "Matter_Progress" },
        pick_list_values: [
          {
            actual_value: "Preparation",
            maps: [
              { actual_value: "Drafting" },
              { display_value: "Review" },
            ],
          },
        ],
      },
    ]);

    expect(map).toEqual({ Preparation: ["Drafting", "Review"] });
  });

  test("limits progress by stage and resets an invalid value", () => {
    const metadata = {
      progressOptions: ["Drafting", "Review", "Lodgement"],
      progressByStage: {
        Preparation: ["Drafting", "Review"],
        Closed: [],
      },
    };

    expect(getAllowedMatterProgressOptions(metadata, "Preparation")).toEqual([
      "Drafting",
      "Review",
    ]);
    expect(
      resolveMatterProgressForStage(metadata, "Preparation", "Lodgement")
    ).toBe("");
    expect(
      resolveMatterProgressForStage(metadata, "Preparation", "Review")
    ).toBe("Review");
    expect(
      getAllowedMatterProgressOptions(metadata, "Preparation", "Legacy value")
    ).toEqual(["Drafting", "Review", "Legacy value"]);
    expect(resolveMatterProgressForStage(metadata, "Closed", "Review")).toBe(
      ""
    );
    expect(
      getAllowedMatterProgressOptions(metadata, "Unknown", "Review")
    ).toEqual(["Review"]);
    expect(getAllowedMatterProgressOptions(metadata, "Unknown")).toEqual([]);
    expect(resolveMatterProgressForStage(metadata, "Unknown", "Review")).toBe(
      ""
    );
  });
});
