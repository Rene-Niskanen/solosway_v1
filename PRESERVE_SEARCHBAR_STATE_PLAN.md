# Plan: Preserve SearchBar State When Switching Views

## Goal
Ensure that SearchBar maintains its state (query value, file attachments, property attachments) when switching between dashboard view and map view. View changes should not disturb what's happening within the SearchBar.

## Current State Analysis

### What's Already Working
1. **Query Value**: Already preserved via `pendingMapQueryRef` and `initialValue` prop
2. **Property Attachments**: Already in `PropertySelectionContext`, so they persist across view changes

### What Needs Fixing
1. **File Attachments**: Currently stored in local `attachedFiles` state in SearchBar component, so they're lost when component unmounts/remounts
2. **Reset Logic**: `resetTrigger` clears everything including attachments, but we don't want to clear attachments when just switching views

## Implementation Steps

### Step 1: Add File Attachments State to MainContent
- Add state in `MainContent.tsx` to store file attachments: `const [preservedFileAttachments, setPreservedFileAttachments] = React.useState<FileAttachmentData[]>([]);`
- This will persist across view changes since MainContent doesn't unmount

### Step 2: Extend SearchBar Ref Interface
- Update the SearchBar ref interface to include methods for getting/setting file attachments:
  - `getFileAttachments: () => FileAttachmentData[]`
  - `setFileAttachments: (files: FileAttachmentData[]) => void`
- Implement these methods in SearchBar component using `useImperativeHandle`

### Step 3: Capture File Attachments Before View Switch
- In `handleMapToggle` in `MainContent.tsx`, before toggling the view:
  - Capture current file attachments from SearchBar using the ref method
  - Store them in `preservedFileAttachments` state
- Also capture file attachments when switching FROM map view back to dashboard

### Step 4: Pass File Attachments to SearchBar
- Add `initialFileAttachments?: FileAttachmentData[]` prop to `SearchBarProps`
- In SearchBar component, initialize `attachedFiles` state from `initialFileAttachments` prop if provided
- Update the SearchBar rendering in MainContent to pass `initialFileAttachments={preservedFileAttachments}`

### Step 5: Update Reset Logic
- Modify the `resetTrigger` effect in SearchBar to NOT clear file attachments when `resetTrigger` is triggered
- Only clear file attachments when explicitly resetting (e.g., after a successful search submission)
- OR: Make resetTrigger more specific - only reset when it's an actual reset, not a view change

### Step 6: Preserve Property Attachments
- Property attachments are already in context, so they should persist
- Verify that property attachments are not cleared when switching views
- Ensure `clearPropertyAttachments` is only called on explicit reset, not on view changes

### Step 7: Test State Preservation
- Test switching from dashboard to map view with:
  - Query text in SearchBar
  - File attachments
  - Property attachments
- Verify all three persist correctly
- Test switching back from map to dashboard view
- Verify state is still preserved

## Files to Modify

1. `frontend-ts/src/components/MainContent.tsx`
   - Add `preservedFileAttachments` state
   - Capture file attachments in `handleMapToggle`
   - Pass `initialFileAttachments` prop to SearchBar

2. `frontend-ts/src/components/SearchBar.tsx`
   - Add `initialFileAttachments` prop to `SearchBarProps`
   - Extend ref interface to include `getFileAttachments` and `setFileAttachments`
   - Initialize `attachedFiles` from `initialFileAttachments` prop
   - Update `resetTrigger` effect to preserve attachments on view changes

## Notes
- Property attachments are already handled by context, so they should persist automatically
- Query value preservation is already implemented, just need to ensure it works with file attachments
- The key insight is that MainContent doesn't unmount when switching views, so we can store state there

