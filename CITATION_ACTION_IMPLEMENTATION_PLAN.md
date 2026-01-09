# Citation Action Menu - Implementation Plan

## Button Title Brainstorming

### Option 1: Direct & Action-Oriented (Recommended)
- **"Add to chat"** - Opens chat panel with citation context, pre-filled query
- **"Save citation"** - Saves citation to curated collection

### Option 2: Descriptive
- **"Ask about this"** - Clear but longer
- **"Add to notes"** - Simpler than "curated writing"

### Option 3: OpenAI-Style
- **"Add to chat"** - Matches OpenAI's "Add to chat" pattern
- **"Save to collection"** - More professional

**Recommended: Use Option 1** - "Add to chat" and "Save citation"

---

## Implementation Plan

### Phase 1: Update Button Titles & Icons ✅
- [x] Change "Ask more about this" → "Add to chat"
- [x] Change "Add to curated writing" → "Save citation"
- [x] Update icons if needed (keep MessageSquare and FileText)

### Phase 2: Implement "Add to chat" Functionality

#### 2.1 Event Handling in MainContent
**File:** `frontend-ts/src/components/MainContent.tsx`

**Tasks:**
1. Add event listener for `citation-ask-more` custom event
2. Extract query and citation data from event detail
3. Open chat panel if not already open:
   - Set `isMapVisible = true` (if needed)
   - Set `hasPerformedSearch = true`
   - Set `shouldExpandChat = true` (if property details open)
4. Pre-fill chat query:
   - Set `mapSearchQuery` to the generated query
   - Pass query to `SideChatPanel` via `query` prop
5. Optionally include document context:
   - If citation has `doc_id`, ensure that document is available in chat context
   - Could add document to `selectedDocumentIds` if needed

**Code Structure:**
```typescript
React.useEffect(() => {
  const handleCitationAskMore = (event: CustomEvent) => {
    const { query, citation, documentId } = event.detail;
    
    // Open chat panel
    if (!isMapVisible) {
      setIsMapVisible(true);
    }
    setHasPerformedSearch(true);
    
    // Pre-fill query
    setMapSearchQuery(query);
    
    // If property details is open, expand chat
    if (isPropertyDetailsOpen) {
      setShouldExpandChat(true);
    }
  };
  
  window.addEventListener('citation-ask-more', handleCitationAskMore as EventListener);
  return () => window.removeEventListener('citation-ask-more', handleCitationAskMore as EventListener);
}, [isMapVisible, isPropertyDetailsOpen]);
```

#### 2.2 Query Generation Enhancement
**File:** `frontend-ts/src/components/StandaloneExpandedCardView.tsx` and `PropertyDetailsPanel.tsx`

**Current Implementation:**
```typescript
const citationText = citation.block_content || 'this information';
const query = `Tell me more about: ${citationText.substring(0, 200)}...`;
```

**Enhancement:**
- Make query more natural and contextual
- Include document name if available
- Optionally include page number

**Improved Query:**
```typescript
const citationText = citation.block_content || 'this information';
const docName = citation.original_filename ? ` from ${citation.original_filename}` : '';
const pageInfo = citation.bbox?.page ? ` (page ${citation.bbox.page})` : '';
const query = `Tell me more about: "${citationText.substring(0, 150)}${citationText.length > 150 ? '...' : ''}"${docName}${pageInfo}`;
```

### Phase 3: Implement "Save citation" Functionality

#### 3.1 Toast Notification
**File:** `frontend-ts/src/components/CitationActionMenu.tsx` or create a toast utility

**Tasks:**
1. Add toast notification when citation is saved
2. Show success message: "Citation saved to collection"
3. Use existing toast system if available, or create simple notification

**Implementation:**
- Check if there's a toast system (shadcn/ui toast)
- If not, create simple notification component
- Show notification on successful save

#### 3.2 Citation Collection UI (Future)
**Files:** New component `CuratedCitationsPanel.tsx`

**Features:**
- View all saved citations
- Filter by document
- Export citations
- Delete citations
- Search within saved citations

**Storage:**
- Currently using localStorage key: `curated_writing_citations`
- Structure:
```typescript
interface SavedCitation {
  id: string;
  citation: CitationData;
  addedAt: string;
  documentName: string;
  content: string;
}
```

### Phase 4: Document Context Integration

#### 4.1 Include Document in Chat Context
**File:** `frontend-ts/src/components/MainContent.tsx`

**Tasks:**
1. When "Add to chat" is clicked, if citation has `doc_id`:
   - Find the property that contains this document
   - Add property to chat context (property attachments)
   - Optionally pre-select the document in document selection mode

**Implementation:**
```typescript
// In citation-ask-more handler
if (documentId) {
  // Find property containing this document
  // Add to property attachments
  // This ensures the document is available in chat context
}
```

### Phase 5: UI Polish

#### 5.1 Loading States
- Show loading indicator when opening chat panel
- Disable buttons while processing

#### 5.2 Error Handling
- Handle case where chat panel can't be opened
- Handle case where document isn't found
- Show error messages to user

#### 5.3 Accessibility
- Add keyboard navigation (Enter to select, Escape to close)
- Add ARIA labels
- Ensure focus management

---

## Implementation Order

1. ✅ **Update button titles** (Quick win)
2. **Add event listener in MainContent** (Core functionality)
3. **Enhance query generation** (Better UX)
4. **Add toast notifications** (User feedback)
5. **Document context integration** (Advanced feature)
6. **Citation collection UI** (Future enhancement)

---

## Testing Checklist

- [ ] Click "Add to chat" opens chat panel
- [ ] Query is pre-filled correctly
- [ ] Chat panel submits query automatically (or user can edit)
- [ ] "Save citation" shows success notification
- [ ] Saved citations appear in localStorage
- [ ] Multiple citations can be saved
- [ ] Works from both PropertyDetailsPanel and StandaloneExpandedCardView
- [ ] Menu closes after action
- [ ] Menu closes on outside click
- [ ] Keyboard navigation works

---

## Future Enhancements

1. **Citation Collection Panel**
   - View all saved citations
   - Export as document
   - Share citations
   - Organize into folders

2. **Smart Query Generation**
   - Use LLM to generate better questions from citation
   - Suggest related questions
   - Context-aware queries

3. **Citation Highlights in Chat**
   - Show which citations were used in responses
   - Link back to document highlights
   - Visual citation trail

4. **Batch Actions**
   - Select multiple citations
   - Bulk save to collection
   - Bulk add to chat

