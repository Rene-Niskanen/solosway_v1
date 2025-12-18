# Document Processing Flow & Timeline

## Overview
This document explains when documents appear in the UI and when property details get updated after document upload.

## 1. Document Upload Flow

### Frontend Upload (`PropertyDetailsPanel.tsx`)
1. **User clicks upload button** → `handleFileInputChange()` triggered
2. **File selected** → `handleFileUpload()` called
3. **Upload to backend** → `backendApi.uploadPropertyDocumentViaProxy()` 
   - Uploads file to S3
   - Creates document record in Supabase with `status='pending'`
   - Returns `document_id`
4. **Immediate UI update** → `loadPropertyDocuments()` called (line 1799)
   - Document appears in UI immediately (even though processing hasn't started)
   - Document shows with `status='pending'` or `status='processing'`

### Backend Processing (`backend/views.py` - `/api/documents/upload`)
1. **Document record created** in Supabase with `status='pending'`
2. **Celery task queued** → `process_document_task.delay(document_id, ...)`
3. **Task starts** → `process_document_classification` → `process_document_with_dual_stores`

## 2. Document Processing Timeline

### Phase 1: Classification & Initial Processing (`tasks.py`)
- **Duration**: ~5-30 seconds
- **Status**: `status='processing'`
- **What happens**:
  - Document classified (valuation_report, lease_agreement, etc.)
  - Reducto parsing (text extraction)
  - Images extracted and uploaded to S3
  - Section headers detected and stored in chunk metadata

### Phase 2: Property Linking (`tasks.py` - line 1928)
- **Duration**: ~10-60 seconds
- **Status**: Still `status='processing'`
- **What happens**:
  - Address extracted from filename or document content
  - Address normalized and geocoded
  - Property hub created/linked (`create_property_with_relationships`)
  - Document linked to property via `property_document_relationships` table

### Phase 3: Property Details Update (`supabase_property_hub_service.py`)
- **Duration**: ~1-5 seconds
- **Status**: Still `status='processing'`
- **What happens**:
  - `_update_property_details()` called (line 322)
  - Extracted data merged into `property_details` table
  - Only updates empty/null fields (merge strategy)
  - Updates `last_enrichment` timestamp

### Phase 4: Vector Storage (`vector_service.py`)
- **Duration**: ~30-120 seconds (depends on document size)
- **Status**: Still `status='processing'`
- **What happens**:
  - Document chunked with dynamic overlap
  - Section headers detected and stored in metadata
  - Chunks embedded (if not already embedded)
  - Vectors stored in Supabase `document_chunks` table

### Phase 5: Completion (`tasks.py`)
- **Duration**: ~1 second
- **Status**: `status='completed'`
- **What happens**:
  - `doc_storage.update_document_status(document_id, status='completed')`
  - Document now searchable in RAG system

## 3. When Documents Appear in UI

### Initial Appearance
- **Immediately after upload** (within 1-2 seconds)
- Document appears in PropertyDetailsPanel document grid
- Status shows as `'pending'` or `'processing'`
- Document is NOT yet searchable

### Status Updates
- **Frontend polling**: `PropertyValuationUpload.tsx` polls `/api/documents/{id}/status` every 5 seconds
- **Status progression**: `pending` → `processing` → `completed`
- **UI updates**: Status badge changes color based on status

### Full Availability
- **When status='completed'**: Document is fully processed and searchable
- **Property details updated**: Property details panel shows extracted data
- **No automatic refresh**: PropertyDetailsPanel does NOT automatically refresh
  - User must manually close/reopen panel OR
  - User must click refresh button (if available)

## 4. When Property Details Get Updated

### During Processing
- **Property details updated** during Phase 3 (Property Linking)
- **Update happens in background** via `_update_property_details()`
- **No frontend notification** - update happens silently

### Frontend Display
- **PropertyDetailsPanel loads details** when panel opens:
  - `useEffect` on line 896 loads property card summary
  - Property details loaded from `property.propertyHub.property_details`
- **No automatic refresh**: Details don't update automatically after processing
  - User must close/reopen panel to see updated details
  - OR property must be re-selected to trigger refresh

## 5. How to Check Processing Status

### Backend Logs
```bash
# Check Celery worker logs (if running separately)
tail -f celery_worker.log

# Check Flask app logs
tail -f app.log

# Check document status in Supabase
SELECT id, original_filename, status, created_at, updated_at 
FROM documents 
ORDER BY created_at DESC 
LIMIT 10;
```

### Frontend Console
- Open browser DevTools → Console
- Look for:
  - `📄 Loading documents for property: {id}`
  - `✅ Loaded documents: {count} documents`
  - `📊 [POLL] Document {id}: status='processing'` or `status='completed'`

### API Endpoint
```bash
GET /api/documents/{document_id}/status
```
Returns:
```json
{
  "success": true,
  "data": {
    "status": "completed",
    "classification_type": "valuation_report",
    "pipeline_progress": {...}
  }
}
```

## 6. Common Issues & Solutions

### Issue: Document not appearing after upload
- **Check**: Is `loadPropertyDocuments()` being called after upload?
- **Solution**: Already implemented (line 1799 in PropertyDetailsPanel.tsx)

### Issue: Document status stuck on 'processing'
- **Check**: Is Celery worker running?
- **Check**: Are there errors in backend logs?
- **Solution**: Check Celery worker status and logs

### Issue: Property details not updating
- **Check**: Is document status 'completed'?
- **Check**: Did property linking succeed?
- **Solution**: Close and reopen PropertyDetailsPanel to refresh

### Issue: Document appears but not searchable
- **Check**: Is status 'completed'?
- **Check**: Are vectors stored? (check `document_chunks` table)
- **Solution**: Wait for processing to complete, or check vector storage logs

## 7. Recommendations

### For Better UX
1. **Add automatic refresh**: Poll document status and refresh PropertyDetailsPanel when status changes to 'completed'
2. **Show processing progress**: Display progress bar or percentage during processing
3. **Notify on completion**: Toast notification when document processing completes
4. **Auto-refresh property details**: Refresh property details panel when document completes

### For Debugging
1. **Add more logging**: Log each phase of processing with timestamps
2. **Add status endpoint**: Return detailed processing status including current phase
3. **Add error notifications**: Show user-friendly error messages if processing fails




































