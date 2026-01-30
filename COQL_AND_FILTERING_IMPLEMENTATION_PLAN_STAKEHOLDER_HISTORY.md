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

### Row Mapping (tempData) – Current Implementation

| UI Field | Source | Notes |
|----------|--------|-------|
| `name` | `Contact_History_Info.Name` > `Contact_Details.Full_Name` > `obj?.Name` | Prefer History name; junction Name may be numeric |
| `id` | `obj?.id` (junction) → after dedup: `history_id` | Junction id; after dedup use history_id as row id |
| `history_id` | `Contact_History_Info.id` | **Use for all History1 API calls** (contacts, attachments, update, delete) |
| `Participants` | Built from `Contact_Details.id` + `Contact_Details.Full_Name` | One per junction row; merged when deduping |
| `date_time` | `Contact_History_Info.Date` or `obj?.Date` | Support expanded COQL paths |
| `type` | `Contact_History_Info.History_Type` or `obj?.History_Type` | |
| `result` | `Contact_History_Info.History_Result` or `obj?.History_Result` | |
| `duration` | `Contact_History_Info.Duration` or `obj?.Duration` | |
| `regarding` | `Contact_History_Info.Regarding` or `obj?.Regarding` | |
| `details` | `Contact_History_Info.History_Details_Plain` or `obj?.History_Details_Plain` | |
| `ownerName` | `getOwnerDisplayName(owner, validUsers)` | Owner from `Owner.first_name` + `Owner.last_name` or `obj?.Owner` |
| `historyDetails` | `obj?.Contact_History_Info` with `id: historyId` | History1 record reference |
| `stakeHolder` | From COQL if present; else from current Account when `module === "Accounts"` | See Part 6.3 |

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

**Option A – Query History_X_Contacts (verified working – use expanded paths):**

```sql
SELECT Name, id, Contact_History_Info.id, Contact_History_Info.Name, Owner.first_name, Owner.last_name, Contact_Details.id, Contact_Details.Full_Name, Contact_History_Info.History_Type, Contact_History_Info.History_Result, Contact_History_Info.Duration, Contact_History_Info.Regarding, Contact_History_Info.History_Details_Plain, Contact_History_Info.Date
FROM History_X_Contacts
WHERE Contact_Details = '{recordId}'
-- OR WHERE Stakeholder = '{recordId}' when parent is Account
LIMIT {offset}, {limit}
```

**Note:** Use expanded paths (`Contact_History_Info.X`, `Owner.first_name`, `Contact_Details.id`). See `STAKEHOLDER_HISTORY_COQL_DELUGE.txt` for the exact working query.

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

- [x] Verify in Zoho/Deluge: module name, WHERE clause, and field support for COQL
- [x] Add `fetchStakeholderHistoryViaCoqlV8` to `src/zohoApi/record.js`
- [x] Update `fetchRLData` in App.js to use COQL v8 with fallback
- [x] Add `preserveFieldsForRecordId` for stakeholder if COQL excludes it
- [x] Add `getOwnerDisplayName` if Owner returns only ID (expanded paths)
- [x] Handle both `response.data` and `response.details.statusMessage` shapes
- [x] Use expanded COQL paths (Contact_History_Info.X, Owner.first_name, Contact_Details.id)
- [x] Add deduplication by history_id (one row per History)

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

- [x] Refactor `filteredData` to `React.useMemo` with correct dependencies
- [x] Add `getActiveFilterNames()` helper
- [x] Add Filter Summary UI above table
- [x] Add `handleClearFilters` and "Clear Filters" button
- [x] Use explicit date parsing for custom range (YYYY-MM-DD)
- [x] Add `getOptionLabel` to Dates Autocomplete (fix [object Object] for custom range)
- [ ] (Optional) Multi-select type filter
- [ ] (Optional) Flexible user matching

---

## Part 3: File Changes Summary

| File | Changes |
|------|---------|
| `src/zohoApi/record.js` | Add `fetchStakeholderHistoryViaCoqlV8` with expanded COQL paths; export from record API |
| `src/App.js` | Use COQL v8 in `fetchRLData` (with fallback); memoize `filteredData`; add filter summary, `getActiveFilterNames`, `handleClearFilters`; add `preserveFieldsForRecordId`; add `getOwnerDisplayName`; row mapping for expanded paths; stakeholder from Account; Participants; deduplication by history_id; Dates `getOptionLabel`; pass `currentModuleData` to Edit dialog |
| `src/components/organisms/Dialog.js` | Use `history_id` for fetchHistoryData, updateHistory, handleDelete, handleAttachmentDelete; exclude junction id from APIData; Owner as `{ id }`; stakeHolder fallback from currentModuleData |
| `src/components/organisms/ContactFields.jsx` | Use `history_id` for fetchParticipantsDetails; fix useEffect deps |
| `src/components/organisms/Table.js` | DownloadButton uses `history_id`; error handling for download |
| `src/zohoApi/file.js` | Safe filename fallback; return error from `downloadAttachmentById` |
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
| COQL v8 (2000 records) | ✓ Implemented | Use expanded paths; see STAKEHOLDER_HISTORY_COQL_DELUGE.txt |
| Fallback to getRelatedRecords | ✓ Implemented | On COQL failure |
| preserveFieldsForRecordId | ✓ Implemented | For stakeholder when COQL excludes it |
| getOwnerDisplayName | ✓ Implemented | For Owner.first_name + Owner.last_name |
| Memoized filtering | ✓ Implemented | useMemo with deps |
| Filter summary | ✓ Implemented | Total count + active filter names |
| Clear filters | ✓ Implemented | Reset all filter state |
| Explicit date parsing | ✓ Implemented | YYYY-MM-DD for custom range |
| Deduplication by history_id | ✓ Implemented | One row per History; merge participants |
| Dates getOptionLabel | ✓ Implemented | Fix [object Object] for custom range |
| Stakeholder from Account | ✓ Implemented | When COQL excludes Stakeholder |
| history_id for History1 APIs | ✓ Implemented | Contacts, attachments, update, delete |
| Contact_History_Info.Name | ✓ Implemented | Prefer over junction Name (number) |
| Owner as { id } for update | ✓ Implemented | Zoho lookup format |
| Multi-select type | Optional | Enhance type filter |

---

## Part 6: Post-Implementation Issues & Fixes (Lessons Learned)

This section documents issues encountered after implementation and how they were fixed. **Use this as a reference when implementing similar solutions in other apps.**

### 6.1 COQL Query – Wrong Field Structure

| Aspect | Issue | Fix |
|--------|-------|-----|
| **Problem** | Initial COQL used flat field names (`Date`, `History_Type`, `Owner`) which did not match the working Deluge query. COQL may return different shapes. | Use **expanded field paths** matching the verified Deluge query. |
| **Working query** | `Contact_History_Info.X`, `Owner.first_name`, `Owner.last_name`, `Contact_Details.Full_Name` | See `STAKEHOLDER_HISTORY_COQL_DELUGE.txt` for the exact working query. |
| **Row mapping** | Must support both flat (getRelatedRecords fallback) and expanded COQL paths. | Use fallback chain: `obj?.Date ?? obj?.["Contact_History_Info.Date"] ?? obj?.Contact_History_Info?.Date` |

**Key takeaway:** Always verify the COQL query in Deluge first. Use expanded paths (`Lookup.Field`) when the API returns them that way.

---

### 6.2 [object Object] in Dates Filter (Custom Range)

| Aspect | Issue | Fix |
|--------|-------|-----|
| **Problem** | When applying Custom Range, `dateRange` became `{ startDate, endDate }` with no `label`. MUI Autocomplete rendered it as `[object Object]`. | Add `getOptionLabel` to the Dates Autocomplete. |
| **Fix** | | `getOptionLabel={(option) => { if (option?.label) return option.label; if (option?.startDate && option?.endDate) return \`${dayjs(option.startDate).format("DD/MM/YYYY")} - ${dayjs(option.endDate).format("DD/MM/YYYY")}\`; return String(option); }}` |
| **Apply to** | Both Dates Autocomplete instances (with data and empty state). | |

**Key takeaway:** When Autocomplete `value` can be an object not in `options`, always provide `getOptionLabel` to avoid `[object Object]`.

---

### 6.3 Stakeholder Not Showing in Edit Dialog

| Aspect | Issue | Fix |
|--------|-------|-----|
| **Problem** | COQL query does not include `Stakeholder` in SELECT. Row mapping got `stakeHolder: null`. Edit dialog showed empty Stakeholder field. | Derive stakeholder when COQL excludes it. |
| **Fix 1** | When `module === "Accounts"` and no Stakeholder from response, set from current Account. | In row mapping: `if (module === "Accounts" && recordId && currentRecord) return { id: recordId, name: currentRecord.Account_Name ?? "Account" };` |
| **Fix 2** | Use API response value, not state (state updates are async). | `const currentRecord = currentModuleResponse?.data?.[0];` then use `currentRecord` in map. |
| **Fix 3** | Pass `currentModuleData` to Edit dialog. | `<Dialog ... currentModuleData={currentModuleData} />` |
| **Fix 4** | Dialog form init fallback when editing. | `else if (selectedRowData && currentModuleData?.Account_Name) stakeHolderValue = { id: currentModuleData.id, name: currentModuleData.Account_Name };` |

**Key takeaway:** When COQL excludes a lookup field, derive it from context (e.g. current record) and pass it to dialogs.

---

### 6.4 Contact / Participants Not Populating in Edit Dialog

| Aspect | Issue | Fix |
|--------|-------|-----|
| **Problem** | Dialog and ContactField used `selectedRowData.id` (junction id) when calling `getRelatedRecords` with Entity `History1`. History1 expects its own record id, not the junction id. | Use **History1 record id** (`history_id`) for all History1 API calls. |
| **Affected** | `fetchHistoryData`, ContactFields `fetchParticipantsDetails`, `updateHistory`, `handleDelete`, `handleAttachmentDelete` | |
| **Fix** | | `const historyId = selectedRowData?.history_id \|\| selectedRowData?.historyDetails?.id \|\| selectedRowData?.id;` then use `historyId` for RecordID. |
| **Row mapping** | Add `history_id` and `Participants` from COQL. | Include `Contact_Details.id` in COQL; build `Participants: [{ id, Full_Name }]` from each row. |
| **Deps** | ContactField useEffect had `[]` – did not refetch when row changed. | Add `selectedRowData?.history_id`, `selectedRowData?.historyDetails?.id`, `selectedRowData?.id` to deps. |

**Key takeaway:** Junction tables have two ids: junction id and the main record id. **Always use the main record id** (History1 id) for History1 APIs (getRelatedRecords, updateRecord, deleteRecord, attachments).

---

### 6.5 Name Showing as Number Instead of Actual Name

| Aspect | Issue | Fix |
|--------|-------|-----|
| **Problem** | Junction `Name` field may be numeric. Table showed numbers instead of participant names. | Use `Contact_History_Info.Name` (History record name) for display. |
| **Fix** | Add to COQL and prefer in row mapping. | `Contact_History_Info.Name` in SELECT; `name = obj?.["Contact_History_Info.Name"] ?? obj?.Contact_History_Info?.Name ?? obj?.["Contact_Details.Full_Name"] ?? obj?.Name ?? "No Name"` |

**Key takeaway:** Junction `Name` can be auto-generated (e.g. number). Prefer the main record's `Name` or `Contact_Details.Full_Name` for display.

---

### 6.6 Update Failing ("Failed to update record")

| Aspect | Issue | Fix |
|--------|-------|-----|
| **Problem 1** | `finalData` included `id: selectedRowData?.id` (junction id). When building APIData for History1 update, this overwrote the correct id. Zoho tried to update History1 with junction id – invalid. | Exclude `id` from finalData when building APIData for History1. |
| **Fix** | | `const { id: _omitId, ...restFinalData } = finalData;` then `APIData: { id: historyId, ...restFinalData }` |
| **Problem 2** | `Owner` was passed as full user object. Zoho expects `Owner: { id: "userId" }` for lookups. | `Owner: selectedOwner?.id ? { id: selectedOwner.id } : undefined` |
| **Problem 3** | `updateHistory` used `selectedRowData?.id` for RecordID. | Use `historyId` (history_id) for all History1 operations. |

**Key takeaway:** For lookup fields (Owner, Stakeholder), send only `{ id: "..." }`. Never send junction id when updating the main record.

---

### 6.7 Attachment Download Not Working

| Aspect | Issue | Fix |
|--------|-------|-----|
| **Problem** | DownloadButton passed `rowId={row?.id}` (junction id). Attachments are stored on the **History1** record, not the junction. | Pass History1 record id to DownloadButton. |
| **Fix** | | `rowId={row?.history_id \|\| row?.historyDetails?.id \|\| row?.id}` |
| **Additional** | Add error handling, snackbar feedback, safe filename fallback. | `fileName \|\| "attachment"`; return `{ data, error }` from downloadAttachmentById. |

**Key takeaway:** Attachments belong to the main record (History1). Use `history_id` for getAttachments and downloadAttachmentById.

---

### 6.8 Duplicate Rows in Table

| Aspect | Issue | Fix |
|--------|-------|-----|
| **Problem** | One History record with multiple contacts = multiple junction rows in History_X_Contacts. COQL returns one row per junction. Table showed duplicate rows (same Date, Type, Result, etc.). | Deduplicate by `history_id`. |
| **Fix** | | After mapping, group by `history_id`; merge participants; show one row per History. |
| **Implementation** | | `const byHistory = new Map();` for each row, `byHistory.set(key, mergedRow)`; merge Participants; use `history_id` as row id. |

**Key takeaway:** Junction tables produce one row per relationship. When displaying "one row per main record," deduplicate by the main record id and merge related data (e.g. participants).

---

### 6.9 Quick Reference: Junction vs Main Record IDs

| Use Case | Use Junction ID (`row.id`) | Use Main Record ID (`row.history_id`) |
|----------|---------------------------|---------------------------------------|
| Table row key (after dedup) | | ✓ |
| Fetch contacts (History1 → Contacts3) | | ✓ |
| Fetch attachments (History1 → Attachments) | | ✓ |
| Update History1 record | | ✓ |
| Delete History1 record | | ✓ |
| Match row for UI update after save | ✓ (or history_id after dedup) | ✓ |

---

### 6.10 Files Modified (Complete List)

| File | Changes |
|------|---------|
| `src/zohoApi/record.js` | COQL query with expanded paths; `Contact_History_Info.Name`, `Contact_Details.id` |
| `src/App.js` | Row mapping for expanded paths; stakeholder from Account; Participants; deduplication by history_id; Dates getOptionLabel; pass currentModuleData to Edit dialog |
| `src/components/organisms/Dialog.js` | Use history_id for fetchHistoryData, updateHistory, handleDelete, handleAttachmentDelete; exclude id from APIData; Owner as { id }; stakeHolder fallback; pass currentModuleData |
| `src/components/organisms/ContactFields.jsx` | Use history_id for fetchParticipantsDetails; fix useEffect deps |
| `src/components/organisms/Table.js` | DownloadButton uses history_id; error handling for download |
| `src/zohoApi/file.js` | Safe filename; return error from downloadAttachmentById |
| `STAKEHOLDER_HISTORY_COQL_DELUGE.txt` | Working Deluge queries with all fields |

---

*Adapted from COQL_AND_FILTERING_IMPLEMENTATION_PLAN.md for migration-solutions-stakeholder-history. Schema verification in Zoho/Deluge is required before COQL implementation. Part 6 documents post-implementation issues and fixes for reuse in other projects.*
