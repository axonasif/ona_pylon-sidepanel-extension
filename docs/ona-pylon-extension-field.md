# Reading Pylon `ona_pylon_extension`

This note documents what we learned while inspecting the live Pylon issue page. It is for a future implementation that stores or reads Ona environment metadata from a Pylon issue custom field instead of only from extension-local storage.

## Goal

Read the issue custom field named `ona_pylon_extension`.

The field appears to be intended as extension-owned storage for Ona/Pylon linkage data.

Observed custom field definition:

```json
{
  "id": "bb26c7a5-f4ee-4929-aa68-95def552a4d2",
  "label": "ona_pylon_extension",
  "type": "text",
  "objectType": "ISSUE",
  "slug": "ona_pylon_extension",
  "source": "pylon",
  "description": "Data storage for https://chromewebstore.google.com/detail/ona-for-pylon/icchbhgbnacneejcmcolhdalkaohjjbm"
}
```

## Reliable Data Source

Use Pylon GraphQL from the page context, same general approach as the existing `ona_ai` tag workflow in `extension/pylon-page-bridge.js`.

Do not use DOM scraping for this field. The issue sidebar can hide fields, omit default values, or render fields in a shape that is less stable than the GraphQL response.

## Requests Needed

### 1. Resolve Issue ID From Ticket Number

The extension already treats `issueNumber` from `location.search` as source of truth.

Use `getIssueByTicketNumber` to convert that ticket number into Pylon's internal issue ID:

```graphql
query getIssueByTicketNumber($orgID: ID!, $ticketNumber: Int!) {
  organization(id: $orgID) {
    id
    issue(number: $ticketNumber) {
      id
      ticketNumber
      title
    }
  }
}
```

Variables:

```json
{
  "orgID": "0ff2638d-686e-4b78-a53d-c7fa19971eb9",
  "ticketNumber": 28067
}
```

### 2. Load Custom Field Definitions

Pylon's `getSidebarIssue` response gives `issue.customFields[].definitionID`, but not the field label or slug. We need definitions to map `ona_pylon_extension` to its stable definition ID.

The Pylon app itself calls `getCustomFieldDefinitions` as a persisted query:

```json
{
  "variables": {
    "orgID": "0ff2638d-686e-4b78-a53d-c7fa19971eb9"
  },
  "operationName": "getCustomFieldDefinitions",
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "d15d9c646f1667af86cc8245ec96d0761fd6054cc84594735533f931ba52135b"
    }
  }
}
```

From that response:

```js
const definition = customFieldDefinitions.find(
  (field) => field.slug === "ona_pylon_extension"
);
```

Expected definition ID:

```text
bb26c7a5-f4ee-4929-aa68-95def552a4d2
```

### 3. Read Issue Custom Fields

The Pylon app itself calls `getSidebarIssue` as a persisted query:

```json
{
  "variables": {
    "orgID": "0ff2638d-686e-4b78-a53d-c7fa19971eb9",
    "issueID": "a6d0e2d0-ab0d-4c1a-8971-5904bf6da00f"
  },
  "operationName": "getSidebarIssue",
  "extensions": {
    "persistedQuery": {
      "version": 1,
      "sha256Hash": "84533afaf35964eecc1205d8735be6a19a96b96292d61572a340dba0ccdc1b1d"
    }
  }
}
```

Read the explicit issue value by joining `issue.customFields` against the definition ID:

```js
const onaPylonExtensionValue =
  issue.customFields.find((field) => field.definitionID === definition.id)?.value ?? null;
```

On the inspected issue `#28067`, the field definition existed, but the issue did not have an explicit `customFields` entry for `bb26c7a5-f4ee-4929-aa68-95def552a4d2`, so the issue-specific value was `null`.

## Important Default Value Note

The field definition had `metadata.defaultValue`, for example:

```json
[
  { "0198e10d-6d9d-7925-a2d7-14533116ccba": "019dd386-a5d9-734d-afff-e59802700ff6" }
]
```

Treat this as definition-level default data, not as an explicit value stored on the current issue. For issue-specific linkage, prefer `issue.customFields[].value` where `definitionID` matches the `ona_pylon_extension` definition.

## Suggested Future Implementation

Add a read-only bridge action first, for example `READ_ONA_PYLON_EXTENSION_FIELD`, in `extension/pylon-page-bridge.js`.

Suggested return shape:

```json
{
  "ok": true,
  "issueNumber": "28067",
  "issueID": "a6d0e2d0-ab0d-4c1a-8971-5904bf6da00f",
  "definitionID": "bb26c7a5-f4ee-4929-aa68-95def552a4d2",
  "value": null,
  "defaultValue": "[\n {\"0198e10d-6d9d-7925-a2d7-14533116ccba\":\"019dd386-a5d9-734d-afff-e59802700ff6\"}\n]"
}
```

After the read path is stable, consider write/update behavior separately. The likely write path is the same mutation family currently used for tags:

```graphql
mutation updateIssueFields($input: UpdateIssueFieldsInput!) {
  updateIssueFields(input: $input) {
    id
    supportState
    customStatus {
      slug
      __typename
    }
    __typename
  }
}
```

For a text custom field, the `fields` payload probably uses the field key/slug and a string value, but we should verify by manually editing this custom field in Pylon and observing the emitted `updateIssueFields` request before implementing writes.

## Debugging Workflow

1. Open a Pylon issue.
2. Reload the page with DevTools Network open.
3. Inspect `getCustomFieldDefinitions`.
4. Inspect `getSidebarIssue`.
5. Match `customFieldDefinitions[].slug === "ona_pylon_extension"`.
6. Match `issue.customFields[].definitionID` to the definition ID.
7. Treat absence from `issue.customFields` as `null` for the explicit issue value.

