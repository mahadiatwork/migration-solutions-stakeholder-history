# COQL v8 & Custom Filtering Implementation Plan

## Overview

This document adapts the patterns from **COQL_AND_FILTERING_IMPLEMENTATION_PLAN.md** (written for migration-solutions-application-history) to the **migration-solutions-stakeholder-history** app, which displays **Stakeholder History** records (History_X_Contacts junction) related to a Contact or Account.

---

## Application Context

| Aspect | Reference App (Application History) | This App (migration-solutions-stakeholder-history) |
|--------|-------------------------------------|-----------------------------------------------------|
| **Parent Entity** | Application | Contact or Account (from `useZohoInit` → `module`) |
| **Parent ID** | `recordId` | `recordId` (from `useZohoInit` → `EntityId`) |
| **Related Data** | Applications_History (direct) | History_X_Contacts (junction) via Stakeholder_History |
| **Module** | Applications | Contacts or Accounts (dynamic) |
| **Related List API Name** | Application_History | **Stakeholder_History** |
| **Current Fetch** | getRelatedRecords | `getRecordsFromRelatedList` → `getRelatedRecords` |
| **Record Limit** | ~200 per page | ~200 per page (getRelatedRecords default) |
| **History Module** | Applications_History | **History1** (Contact_History_Info) |
| **Junction Module** | N/A | **History_X_Contacts** |

---

## Current Data Structure (from App.js)

### Row Mapping (tempData)

| UI Field | Source | Notes |
|----------|--------|-------|
| `name` | `obj?.Name` | Display name |
| `id` | `obj?.id` | Record ID (junction or History1 – verify) |
| `date_time` | `obj?.Date` | |
| `type` | `obj?.History_Type` | |
| `result` | `obj?.History_Result` | |
| `duration` | `obj?.Duration` | |
| `regarding` | `obj?.Regarding` | |
| `details` | `obj?.History_Details_Plain` | |
| `ownerName` | `obj?.Owner?.name` | |
| `historyDetails` | `obj?.Contact_History_Info` | History1 record reference |
| `stakeHolder` | `Contact_History_Info.Stakeholder` or `obj?.Stakeholder` | Lookup; supports flat, nested, junction shapes |

### Current Filter State

| Filter | State | Type | Notes |
|--------|-------|------|-------|
| Date | `dateRange` | Object | preDay, custom, startDate/endDate |
| Type | `selectedType` | string \| null | Single select |
| Keyword | `keyword` | string | Text search in name, details, regarding |
| User (Owner) | `selectedOwner` | object \| null | Single select |

### Table Columns

Date & Time, Type, Result, Duration, Regarding & Details, Attachment, Record Owner, Name

---

## Part 1: COQL v8 – 2000 Records in One API Call

### 1.1 Schema Verification Required

**Before implementing COQL**, verify in Zoho:

1. **Related list "Stakeholder_History"** – What module does it query?
   - If parent is **Contact**: Likely `History_X_Contacts` WHERE `Contact_Details = recordId`
   - If parent is **Account**: May use a different relationship (e.g. via Stakeholder lookup)

2. **History_X_Contacts** (junction) – COQL-queryable fields:
   - `Contact_Details` (lookup to Contact)
   - `Contact_History_Info` (lookup to History1)
   - `Stakeholder` (lookup to Account)
   - Other fields: `Name`, `Date`, `History_Type`, `History_Result`, `Duration`, `Regarding`, `History_Details_Plain`, `Owner` – may be on junction or come from related Contact_History_Info

3. **History1** (Contact_History_Info) – If COQL queries this directly:
   - Lookup to parent (Contact or Account)
   - Fields: `Name`, `Date`, `History_Type`, `History_Result`, `Duration`, `Regarding`, `History_Details_Plain`, `Owner`, `Stakeholder`

**Recommended test in Deluge** before coding:

```deluge
// When parent is Contact:
recordId = "CONTACT_RECORD_ID";  // From widget context
selectQuery = "SELECT id, Name, Date, History_Type, History_Result, Regarding, History_Details_Plain, Owner, Contact_History_Info, Stakeholder FROM History_X_Contacts WHERE Contact_Details = '" + recordId + "' LIMIT 0, 2000";

// OR if Stakeholder_History returns History1 records linked via a different path:
// selectQuery = "SELECT ... FROM History1 WHERE ... LIMIT 0, 2000";
```

### 1.2 COQL Query Options (To Be Verified)

**Option A – Query History_X_Contacts (if parent is Contact):**

```sql
SELECT id, Name, Date, History_Type, History_Result, Regarding, History_Details_Plain, Owner, Contact_History_Info, Stakeholder, Duration
FROM History_X_Contacts
WHERE Contact_Details = '{recordId}'
LIMIT {offset}, {limit}
```

**Option B – Query History1 (if relationship allows):**

If the parent is Account and History1 has a direct lookup to Account:

```sql
SELECT id, Name, Date, History_Type, History_Result, Regarding, History_Details_Plain, Owner, Duration
FROM History1
WHERE [Parent_Lookup_Field] = '{recordId}'
LIMIT {offset}, {limit}
```

**Fields that may cause COQL to fail** (exclude initially, add back after testing):
- `Stakeholder` – sometimes not supported in COQL
- `Owner.name`, `Owner.id` – use `Owner` only (whole lookup)
- `Contact_History_Info.Stakeholder` – nested lookups can fail

**If Stakeholder is excluded**: Use `preserveFieldsForRecordId` when refetching after stakeholder update (see Part 1.4).

### 1.3 Implementation Steps

#### Step 1: Add COQL v8 Fetch Helper

**Location:** `src/zohoApi/record.js` (or new `src/zohoApi/coql.js`)

```javascript
import { dataCenterMap, conn_name } from "../config/config";

const ZOHO = window.ZOHO;

/**
 * Fetch Stakeholder History via COQL v8 API (up to 2000 records in one call)
 * Schema must be verified: History_X_Contacts vs History1, and correct WHERE clause
 * @param {string} module - Parent module (Contacts, Accounts, etc.)
 * @param {string} recordId - Parent record ID
 * @param {number} [limit=2000]
 * @param {number} [offset=0]
 * @returns {Promise<Array>}
 */
export async function fetchStakeholderHistoryViaCoqlV8(
  module,
  recordId,
  limit = 2000,
  offset = 0
) {
  // VERIFY: Adjust module name and WHERE clause per your Zoho schema
  // Option A: History_X_Contacts (when parent is Contact)
  const whereClause = module === "Contacts"
    ? `Contact_Details = '${recordId}'`
    : module === "Accounts"
      ? `Stakeholder = '${recordId}'`  // Or correct lookup - VERIFY
      : `Contact_Details = '${recordId}'`;  // Fallback

  const fromModule = "History_X_Contacts";  // Or "History1" - VERIFY

  const selectQuery = `SELECT id, Name, Date, History_Type, History_Result, Regarding, History_Details_Plain, Owner, Contact_History_Info, Stakeholder, Duration FROM ${fromModule} WHERE ${whereClause} LIMIT ${offset}, ${limit}`;

  const req_data = {
    url: `${dataCenterMap.AU}/crm/v8/coql`,
    method: "POST",
    param_type: 2,
    parameters: { select_query: selectQuery },
  };

  const response = await ZOHO.CRM.CONNECTION.invoke(conn_name, req_data);

  let data = [];
  if (response?.data) {
    data = Array.isArray(response.data) ? response.data : [];
  } else if (response?.details?.statusMessage) {
    const sm = response.details.statusMessage;
    const parsed = typeof sm === "string" ? JSON.parse(sm || "{}") : sm;
    data = Array.isArray(parsed?.data) ? parsed.data : [];
  }

  return data;
}
```

#### Step 2: Update `fetchRLData` in App.js

**Current:**
```javascript
const { data } = await zohoApi.record.getRecordsFromRelatedList({
  module,
  recordId,
  RelatedListAPI: "Stakeholder_History",
});
```

**Target – Use COQL v8 with fallback:**
```javascript
let data = [];
try {
  data = await zohoApi.record.fetchStakeholderHistoryViaCoqlV8(module, recordId, 2000, 0);
} catch (coqlError) {
  console.warn("COQL v8 failed, falling back to getRelatedRecords:", coqlError);
  const resp = await zohoApi.record.getRecordsFromRelatedList({
    module,
    recordId,
    RelatedListAPI: "Stakeholder_History",
  });
  data = resp?.data || [];
}
```

#### Step 3: Preserve Stakeholder on Background Refetch

If COQL does **not** return `Stakeholder`, add `preserveFieldsForRecordId` support:

**In fetchRLData options:**
```javascript
fetchRLData(options = { preserveFieldsForRecordId: null })
```

**When calling after stakeholder update:**
```javascript
fetchRLData({
  isBackground: true,
  preserveFieldsForRecordId: { id: updatedRecord.id, stakeHolder: normalizedRecord.stakeHolder },
});
```

**In row mapping:**
```javascript
const preserved = options.preserveFieldsForRecordId;
// ...
stakeHolder: (() => {
  if (preserved && obj?.id === preserved.id && preserved.stakeHolder) {
    return preserved.stakeHolder;
  }
  // ... existing stakeHolder mapping
})(),
```

#### Step 4: Owner Display Name Helper

If COQL returns `Owner` as `{ id }` only, add `getOwnerDisplayName`:

```javascript
const getOwnerDisplayName = (owner, users) => {
  if (!owner) return "Unknown Owner";
  const name = owner?.name ?? owner?.full_name ?? owner?.Name ?? owner?.Full_Name;
  if (name) return name;
  const id = typeof owner === "object" ? owner?.id : owner;
  if (!id || !users?.length) return "Unknown Owner";
  const user = users.find((u) => u?.id === id);
  return user?.full_name ?? "Unknown Owner";
};

// In row mapping:
ownerName: getOwnerDisplayName(obj?.Owner, validUsers),
```

### 1.4 Checklist (COQL v8)

- [ ] Verify in Zoho/Deluge: module name, WHERE clause, and field support for COQL
- [ ] Add `fetchStakeholderHistoryViaCoqlV8` to `src/zohoApi/record.js`
- [ ] Update `fetchRLData` in App.js to use COQL v8 with fallback
- [ ] Add `preserveFieldsForRecordId` for stakeholder if COQL excludes it
- [ ] Add `getOwnerDisplayName` if Owner returns only ID
- [ ] Handle both `response.data` and `response.details.statusMessage` shapes
- [ ] Test with a Contact/Account that has 200+ history records

---

## Part 2: Custom Filtering Enhancements

### 2.1 Current vs Target

| Enhancement | Current | Target |
|-------------|---------|--------|
| **filteredData** | Chained `.filter()` | `React.useMemo` with deps |
| **Filter Summary** | None | "Total Records X • Filter By: ..." |
| **Clear Filters** | None | Button to reset all filters |
| **Date Parsing** | `dayjs(el?.date_time)` | Explicit format for custom range |
| **Multi-Select Type** | Single | Optional: multi-select |

### 2.2 Implementation Steps

#### Step 1: Memoize `filteredData`

**Location:** `src/App.js`

**Current:**
```javascript
const filteredData = relatedListData
  ?.filter(...)
  ?.filter(...)
  ?.filter(...)
  ?.filter(...);
```

**Replace with:**
```javascript
const filteredData = React.useMemo(() => {
  if (!relatedListData?.length) return [];
  return relatedListData
    .filter((el) =>
      selectedOwner ? el.ownerName === selectedOwner?.full_name : true
    )
    .filter((el) => (selectedType ? el?.type === selectedType : true))
    .filter((el) => {
      if (dateRange?.preDay) {
        const isValidDate = dayjs(el?.date_time).isValid();
        return isValidDate && isInLastNDays(el?.date_time, dateRange?.preDay);
      }
      if (dateRange?.startDate && dateRange?.endDate) {
        const rowDate = dayjs(el?.date_time);
        const start = dayjs(dateRange.startDate).startOf("day");
        const end = dayjs(dateRange.endDate).endOf("day");
        return rowDate.isBetween(start, end, null, "[]");
      }
      if (dateRange?.custom) {
        const startDate = dayjs(dateRange.custom());
        const endDate = dayjs();
        return dayjs(el?.date_time).isBetween(startDate, endDate, null, "[]");
      }
      return true;
    })
    .filter((el) => {
      if (!keyword?.trim()) return true;
      const kw = keyword.trim().toLowerCase();
      return (
        el.name?.toLowerCase().includes(kw) ||
        el.details?.toLowerCase().includes(kw) ||
        el.regarding?.toLowerCase().includes(kw)
      );
    });
}, [
  relatedListData,
  selectedOwner,
  selectedType,
  dateRange,
  keyword,
]);
```

#### Step 2: Add Filter Summary and Clear Filters

**Helper:**
```javascript
const getActiveFilterNames = () => {
  const active = [];
  if (dateRange?.preDay || dateRange?.startDate || dateRange?.custom) active.push("Date");
  if (selectedType) active.push("Type");
  if (selectedOwner) active.push("User");
  if (keyword?.trim()) active.push("Keyword");
  return active;
};

const handleClearFilters = () => {
  setDateRange(dateOptions[0]);
  setSelectedType(null);
  setSelectedOwner(null);
  setKeyword("");
  setCustomRange({ startDate: null, endDate: null });
  setIsCustomRangeDialogOpen(false);
};
```

**UI (above Table):**
```jsx
<Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, fontSize: "9pt" }}>
  <span>Total Records {filteredData?.length ?? 0}</span>
  {getActiveFilterNames().length > 0 && (
    <>
      <span>•</span>
      <span>Filter By: {getActiveFilterNames().join(", ")}</span>
      <Button size="small" onClick={handleClearFilters} sx={{ ml: 1 }}>
        Clear Filters
      </Button>
    </>
  )}
</Box>
```

#### Step 3: Explicit Date Parsing (Custom Range)

When applying custom range, store and parse with explicit format:

```javascript
// When applying custom range
setDateRange({
  ...customRange,
  startDate: customRange.startDate ? dayjs(customRange.startDate).format("YYYY-MM-DD") : null,
  endDate: customRange.endDate ? dayjs(customRange.endDate).format("YYYY-MM-DD") : null,
});

// In filter
if (dateRange?.startDate && dateRange?.endDate) {
  const rowDate = dayjs(el?.date_time);
  const start = dayjs(dateRange.startDate, "YYYY-MM-DD").startOf("day");
  const end = dayjs(dateRange.endDate, "YYYY-MM-DD").endOf("day");
  return rowDate.isBetween(start, end, null, "[]");
}
```

### 2.3 Checklist (Custom Filtering)

- [ ] Refactor `filteredData` to `React.useMemo` with correct dependencies
- [ ] Add `getActiveFilterNames()` helper
- [ ] Add Filter Summary UI above table
- [ ] Add `handleClearFilters` and "Clear Filters" button
- [ ] Use explicit date parsing for custom range
- [ ] (Optional) Multi-select type filter
- [ ] (Optional) Flexible user matching

---

## Part 3: File Changes Summary

| File | Changes |
|------|---------|
| `src/zohoApi/record.js` | Add `fetchStakeholderHistoryViaCoqlV8`; export from record API |
| `src/App.js` | Use COQL v8 in `fetchRLData` (with fallback); memoize `filteredData`; add filter summary, `getActiveFilterNames`, `handleClearFilters`; add `preserveFieldsForRecordId`; add `getOwnerDisplayName` if needed |
| `src/config/config.js` | No change (AU + conn_name already correct) |

---

## Part 4: Key Differences from Application History Plan

| Aspect | Application History | Stakeholder History (This App) |
|--------|---------------------|--------------------------------|
| Parent | Application | Contact or Account |
| Related List | Application_History | Stakeholder_History |
| Data Module | Applications_History | History_X_Contacts (junction) + History1 |
| COQL FROM | Applications_History | History_X_Contacts or History1 (verify) |
| COQL WHERE | Application = recordId | Contact_Details = recordId or Stakeholder = recordId (verify) |
| Stakeholder | N/A or different | On junction; use preserveFields if COQL excludes |
| Record Link | Applications_History | History1 (CustomModule4) |
| Attachments | Applications_History | History1 |

---

## Part 5: Testing

1. **COQL v8**
   - Open a Contact/Account with 200+ history records
   - Confirm all records load (check count)
   - If COQL fails, confirm fallback to getRelatedRecords works
   - Verify stakeholder and owner display correctly after refetch

2. **Filtering**
   - Apply each filter (Date, Type, User, Keyword) and verify results
   - Use "Clear Filters" and confirm all filters reset
   - Check Filter Summary shows correct active filters and count

3. **Custom Date Range**
   - Select Custom Range, pick start/end, apply
   - Verify only records in that range are shown

---

## Summary

| Feature | Status | Notes |
|---------|--------|-------|
| COQL v8 (2000 records) | To implement | **Verify schema first** (History_X_Contacts vs History1, WHERE clause) |
| Fallback to getRelatedRecords | To implement | On COQL failure |
| preserveFieldsForRecordId | To implement | For stakeholder when COQL excludes it |
| getOwnerDisplayName | To implement | If Owner returns only ID |
| Memoized filtering | To implement | useMemo with deps |
| Filter summary | To implement | Total count + active filter names |
| Clear filters | To implement | Reset all filter state |
| Explicit date parsing | To implement | For custom range |
| Multi-select type | Optional | Enhance type filter |

---

*Adapted from COQL_AND_FILTERING_IMPLEMENTATION_PLAN.md for migration-solutions-stakeholder-history. Schema verification in Zoho/Deluge is required before COQL implementation.*
