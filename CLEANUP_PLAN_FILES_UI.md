# Cleanup Plan: Restore Original Document View

This plan outlines the steps to simplify the Property Details view, restoring the original "file storage" design while applying the requested styling (Black background, White folders).

## Goals
1. **Remove Complexity**: Simplify `PropertyDetailsPanel` to focusing solely on the Document view.
2. **Restore UX**: Remove the tabbed sidebar navigation.
3. **Style Updates**:
   - Remove background blur from the modal backdrop.
   - Resize the modal to be smaller (focused on the file stack).
   - Ensure "Black Background, White Folder" aesthetic.
4. **Code Cleanup**: Remove unused sections (Overview, Details, Financials) from the rendering logic.

## Execution Steps

### 1. Modify `PropertyDetailsPanel.tsx`
- [ ] **Remove State**: Remove `activeSection` state and `SECTION_TABS` constant.
- [ ] **Remove Sidebar**: Delete the left sidebar column in the main render return.
- [ ] **Simplify Render**: 
    - Remove `switch` statement.
    - Always render the `documents` case logic.
- [ ] **Update Styles**:
    - **Modal Dimensions**: Change `width: '950px', height: '650px'` to a smaller size (e.g., `width: '600px', height: '600px'`).
    - **Backdrop**: Remove `backdrop-blur-md` from the backdrop div.
    - **Container**: Ensure the main container background is Black/Dark (`#1E1E1E` / `#121212`).
    - **Document Cards**: Ensure the document cards are White (`#FFFFFF`) with appropriate shadows/gradients.
- [ ] **Cleanup Code**: Remove the unused sub-component rendering functions (Overview, Details, Financials logic).

### 2. Verify Interactions
- Ensure clicking the `PropertyTitleCard` still correctly opens this simplified panel.
- Ensure closing the panel works.
- Verify file upload/selection/deletion still works in the simplified view.

### 3. Future Considerations
- If the other sections (Overview, Details, Financials) are needed later, they can be reintroduced or moved to a separate component if the user decides to expand the feature set again.

