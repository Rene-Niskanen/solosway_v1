# New Property Pin Creation Workflow - Detailed Implementation Plan

## Overview
Create a new workflow that allows users to create a property pin by:
1. Uploading files (left card)
2. Selecting a location on a map (right card)
3. Creating the property pin with associated files at the chosen location

---

## 1. UI/UX Design Analysis

### 1.1 Reference Image Analysis (Based on Description)
- **Background Color**: `#D8CBBD` (beige/tan - warm, neutral tone)
- **Layout**: 2-card system centered on screen
- **Card Structure**: 
  - Left Card: File upload interface
  - Right Card: Map for location selection
- **Visual Style**: Clean, modern, centered layout with ample spacing

### 1.2 Design Specifications

#### Background
- **Color**: `#D8CBBD` (hex) / `rgb(216, 203, 189)`
- **Full viewport coverage**: `fixed inset-0`
- **Z-index**: Below cards but above default background

#### Card Container
- **Layout**: Horizontal flex container, centered
- **Spacing**: Gap between cards (suggested: 24-32px)
- **Max width**: ~1200-1400px (to prevent cards from being too wide)
- **Responsive**: Stack vertically on mobile (< 768px)
- **Centering**: `flex items-center justify-center` with `min-h-screen`

#### Individual Cards
- **Width**: ~500-600px each (or 45-48% of container width)
- **Height**: ~600-700px (or min-height based on content)
- **Background**: White (`#FFFFFF`)
- **Border radius**: 12-16px (rounded-xl or rounded-2xl)
- **Shadow**: Medium elevation (`shadow-lg` or `shadow-xl`)
- **Padding**: 24-32px internal padding

---

## 2. Component Architecture

### 2.1 New Component: `NewPropertyPinWorkflow.tsx`

**Location**: `frontend-ts/src/components/NewPropertyPinWorkflow.tsx`

**Props Interface**:
```typescript
interface NewPropertyPinWorkflowProps {
  isVisible: boolean;
  onClose: () => void;
  onPropertyCreated?: (propertyId: string, propertyData: any) => void;
}
```

**State Management**:
```typescript
// File upload state
const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
const [uploading, setUploading] = useState(false);

// Location selection state
const [selectedLocation, setSelectedLocation] = useState<{
  lat: number;
  lng: number;
  address?: string;
} | null>(null);

// Property creation state
const [isCreating, setIsCreating] = useState(false);
const [error, setError] = useState<string | null>(null);
const [propertyId, setPropertyId] = useState<string | null>(null);
```

### 2.2 Sub-Components

#### 2.2.1 `FileUploadCard.tsx` (Left Card)
- **Purpose**: Handle file uploads and display uploaded files
- **Features**:
  - Drag & drop zone
  - File input button
  - File list with previews
  - Remove file functionality
  - Upload progress indicators
  - File type validation

#### 2.2.2 `LocationSelectionCard.tsx` (Right Card)
- **Purpose**: Display map and allow location selection
- **Features**:
  - Embedded Mapbox map (similar to SquareMap but simplified)
  - Click-to-select location
  - Address geocoding display
  - Location marker/pin
  - Search bar for address lookup

---

## 3. Navigation Flow

### 3.1 Entry Point
**File**: `frontend-ts/src/components/RecentProjectsSection.tsx`

**Current State** (line 121-141):
- "New Project" card exists but has no click handler
- Card shows Plus icon and "New Project" text

**Required Changes**:
1. Add `onNewProjectClick` prop to `RecentProjectsSection`
2. Add click handler to "New Project" card
3. Pass handler from `MainContent.tsx`

### 3.2 MainContent Integration

**File**: `frontend-ts/src/components/MainContent.tsx`

**New State**:
```typescript
const [showNewPropertyWorkflow, setShowNewPropertyWorkflow] = useState(false);
```

**Handler**:
```typescript
const handleNewProjectClick = () => {
  setShowNewPropertyWorkflow(true);
  // Optionally hide other views
  setCurrentView('new-property');
};
```

**Render**:
```typescript
{showNewPropertyWorkflow && (
  <NewPropertyPinWorkflow
    isVisible={showNewPropertyWorkflow}
    onClose={() => {
      setShowNewPropertyWorkflow(false);
      setCurrentView('search'); // Return to search view
    }}
    onPropertyCreated={(propertyId, propertyData) => {
      // Handle successful creation
      // Optionally navigate to map view with new property selected
      setShowNewPropertyWorkflow(false);
      setIsMapVisible(true);
      // Set pending selection for map
      (window as any).__pendingPropertySelection = {
        address: propertyData.address,
        coordinates: { lat: propertyData.latitude, lng: propertyData.longitude },
        propertyId: propertyId
      };
    }}
  />
)}
```

---

## 4. File Upload Implementation

### 4.1 File Upload Card Features

#### Drag & Drop Zone
- **Visual**: Dashed border, centered icon, "Drop files here" text
- **States**: 
  - Default: Light gray background
  - Drag over: Highlighted border, darker background
  - Active: Show file count

#### File Input
- **Button**: "Choose Files" or "Browse"
- **Accept**: All file types (or specific: images, PDFs, documents)
- **Multiple**: Allow multiple file selection

#### File List Display
- **Layout**: Grid or list of file cards
- **Each File Card Shows**:
  - File icon/thumbnail (for images)
  - File name (truncated if long)
  - File size
  - Remove button (X icon)
  - Upload progress bar (when uploading)

#### Upload Progress
- **Per-file progress**: Track each file individually
- **Visual**: Progress bar below file name
- **Status**: "Uploading...", "Complete", "Error"

### 4.2 File Upload Logic

**Reuse Existing Upload Function**:
- Use `backendApi.uploadPropertyDocumentViaProxy()` (from `PropertyDetailsPanel.tsx`)
- **BUT**: Property doesn't exist yet, so we need a different approach

**New Approach**:
1. **Store files temporarily** in component state
2. **Create property first** (with location)
3. **Then upload files** to the newly created property
4. **Alternative**: Upload files first, then create property and link them

**Recommended Flow**:
```
1. User selects location → Get coordinates
2. User uploads files → Store in state (not uploaded yet)
3. User clicks "Create Property" → 
   a. Create property with location
   b. Upload all files to new property
   c. Link files to property
4. Show success → Navigate to map with property selected
```

---

## 5. Location Selection Implementation

### 5.1 Map Integration

**Component**: Simplified version of `SquareMap.tsx`

**Features**:
- Mapbox map instance
- Click handler to set location
- Marker at selected location
- Address geocoding (reverse geocode on click)
- Search bar for address lookup

**State**:
```typescript
const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null);
const [selectedCoordinates, setSelectedCoordinates] = useState<[number, number] | null>(null);
const [selectedAddress, setSelectedAddress] = useState<string>('');
```

### 5.2 Location Selection Flow

1. **Map Initialization**:
   - Default center: User's location (if available) or London
   - Default zoom: 12-14 (city level)
   - Enable click events

2. **Click Handler**:
   ```typescript
   const handleMapClick = async (e: mapboxgl.MapMouseEvent) => {
     const { lng, lat } = e.lngLat;
     setSelectedCoordinates([lng, lat]);
     
     // Reverse geocode to get address
     const address = await reverseGeocode(lng, lat);
     setSelectedAddress(address);
     
     // Add/update marker
     updateLocationMarker(lng, lat);
   };
   ```

3. **Address Search**:
   - Use Mapbox Geocoding API
   - Search input in card header
   - Show results dropdown
   - On selection: Fly to location and set coordinates

4. **Visual Feedback**:
   - Marker at selected location
   - Address displayed below map
   - "Location selected" confirmation

---

## 6. Backend API Integration

### 6.1 Property Creation Endpoint

**Current State**: Properties are created via `create_property_with_relationships()` in backend services, but this is typically called during document upload.

**Required**: New endpoint for manual property creation

**New Endpoint**: `POST /api/properties/create`

**Request Body**:
```json
{
  "address": "123 Main St, London, UK",
  "latitude": 51.5074,
  "longitude": -0.1276,
  "formatted_address": "123 Main Street, London, UK",
  "normalized_address": "123 main st london uk"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "property_id": "uuid",
    "property": {
      "id": "uuid",
      "address": "...",
      "latitude": 51.5074,
      "longitude": -0.1276,
      ...
    }
  }
}
```

### 6.2 File Upload After Property Creation

**Use Existing Endpoint**: `POST /api/documents/upload`

**Flow**:
1. Create property → Get `property_id`
2. For each file:
   - Upload via `uploadPropertyDocumentViaProxy(file, { property_id })`
   - Track progress
   - Handle errors

### 6.3 Backend Implementation

**File**: `backend/views.py`

**New Route**:
```python
@views.route('/api/properties/create', methods=['POST', 'OPTIONS'])
@login_required
def create_property():
    """Create a new property with location"""
    if request.method == 'OPTIONS':
        return _handle_cors_preflight()
    
    try:
        data = request.get_json()
        business_uuid = _ensure_business_uuid()
        
        # Validate required fields
        if not data.get('latitude') or not data.get('longitude'):
            return jsonify({'success': False, 'error': 'Location required'}), 400
        
        # Create address hash
        address = data.get('address', '')
        address_hash = hashlib.sha256(address.lower().encode()).hexdigest()
        
        # Create property using existing service
        from .services.supabase_property_hub_service import SupabasePropertyHubService
        service = SupabasePropertyHubService()
        
        address_data = {
            'address_hash': address_hash,
            'normalized_address': data.get('normalized_address', address),
            'formatted_address': data.get('formatted_address', address),
            'latitude': data['latitude'],
            'longitude': data['longitude'],
            'geocoding_status': 'manual',
            'geocoding_confidence': 1.0
        }
        
        # Create property (without document - we'll upload files separately)
        property_id = str(uuid.uuid4())
        property_data = service._create_supabase_property(property_id, address_data, business_uuid)
        
        return jsonify({
            'success': True,
            'data': {
                'property_id': property_id,
                'property': property_data
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating property: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500
```

---

## 7. Component Structure

### 7.1 Main Component Layout

```tsx
<NewPropertyPinWorkflow>
  {/* Background */}
  <div className="fixed inset-0" style={{ backgroundColor: '#D8CBBD', zIndex: 50 }}>
    
    {/* Header with close button */}
    <header>
      <button onClick={onClose}>×</button>
      <h1>Create New Property Pin</h1>
    </header>
    
    {/* Card Container */}
    <div className="flex gap-8 max-w-7xl mx-auto">
      
      {/* Left Card - File Upload */}
      <FileUploadCard
        files={uploadedFiles}
        onFilesChange={setUploadedFiles}
        uploading={uploading}
        uploadProgress={uploadProgress}
      />
      
      {/* Right Card - Location Selection */}
      <LocationSelectionCard
        selectedLocation={selectedLocation}
        onLocationSelect={setSelectedLocation}
        mapInstance={mapInstance}
      />
      
    </div>
    
    {/* Footer Actions */}
    <footer>
      <button onClick={onClose}>Cancel</button>
      <button 
        onClick={handleCreateProperty}
        disabled={!canCreate}
      >
        Create Property
      </button>
    </footer>
    
  </div>
</NewPropertyPinWorkflow>
```

### 7.2 FileUploadCard Component

```tsx
<FileUploadCard>
  <div className="card">
    <h2>Upload Files</h2>
    
    {/* Drag & Drop Zone */}
    <div 
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="drop-zone"
    >
      <UploadIcon />
      <p>Drop files here or click to browse</p>
      <input 
        type="file" 
        multiple 
        onChange={handleFileSelect}
        ref={fileInputRef}
      />
    </div>
    
    {/* File List */}
    <div className="file-list">
      {uploadedFiles.map((file, index) => (
        <FileCard
          key={index}
          file={file}
          progress={uploadProgress[file.name]}
          onRemove={() => removeFile(index)}
        />
      ))}
    </div>
  </div>
</FileUploadCard>
```

### 7.3 LocationSelectionCard Component

```tsx
<LocationSelectionCard>
  <div className="card">
    <h2>Select Location</h2>
    
    {/* Address Search */}
    <input 
      type="text"
      placeholder="Search for address..."
      value={searchQuery}
      onChange={handleSearchChange}
    />
    
    {/* Map Container */}
    <div ref={mapContainer} className="map-container" />
    
    {/* Selected Location Display */}
    {selectedAddress && (
      <div className="selected-location">
        <p>{selectedAddress}</p>
        <p>Lat: {selectedCoordinates[1]}, Lng: {selectedCoordinates[0]}</p>
      </div>
    )}
  </div>
</LocationSelectionCard>
```

---

## 8. State Management & Data Flow

### 8.1 Component State Flow

```
1. User clicks "New Project" card
   → setShowNewPropertyWorkflow(true)

2. User uploads files
   → setUploadedFiles([...files])
   → Files stored in component state (not uploaded yet)

3. User selects location on map
   → setSelectedLocation({ lat, lng, address })
   → Marker appears on map

4. User clicks "Create Property"
   → setIsCreating(true)
   → 
   a. Create property via API
   b. For each file: Upload to property
   c. Track progress
   →
   → setIsCreating(false)
   → onPropertyCreated(propertyId, propertyData)
   → Navigate to map view
```

### 8.2 Validation

**Before Creating Property**:
- At least one file uploaded OR location selected (or require both?)
- Location coordinates are valid numbers
- Files are valid (size limits, type restrictions if any)

**Error Handling**:
- Property creation fails → Show error, allow retry
- File upload fails → Show which file failed, allow retry
- Network errors → Show retry option

---

## 9. UI/UX Enhancements

### 9.1 Loading States
- **Creating property**: Show spinner, disable buttons
- **Uploading files**: Show progress per file
- **Geocoding address**: Show loading indicator

### 9.2 Success States
- **Property created**: Show success message
- **Files uploaded**: Show checkmarks
- **Auto-navigate**: After 1-2 seconds, navigate to map

### 9.3 Error States
- **Validation errors**: Show inline errors
- **API errors**: Show toast/alert with retry option
- **Network errors**: Show connection error message

### 9.4 Responsive Design
- **Desktop**: Side-by-side cards
- **Tablet**: Stacked cards (vertical)
- **Mobile**: Full-width cards, simplified UI

---

## 10. Integration Points

### 10.1 RecentProjectsSection.tsx
- Add `onNewProjectClick` prop
- Add click handler to "New Project" card (line 326-328)

### 10.2 MainContent.tsx
- Add state: `showNewPropertyWorkflow`
- Add handler: `handleNewProjectClick`
- Render `NewPropertyPinWorkflow` component
- Handle navigation after property creation

### 10.3 backendApi.ts
- Add method: `createProperty(address, coordinates)`
- Reuse existing: `uploadPropertyDocumentViaProxy()`

### 10.4 SquareMap.tsx
- No changes needed (reuse for navigation after creation)

---

## 11. Implementation Steps

### Phase 1: Basic Structure
1. Create `NewPropertyPinWorkflow.tsx` component
2. Add background and card container layout
3. Add navigation from "New Project" card
4. Add close button and basic state

### Phase 2: File Upload Card
1. Create `FileUploadCard.tsx`
2. Implement drag & drop
3. Implement file list display
4. Add file removal functionality

### Phase 3: Location Selection Card
1. Create `LocationSelectionCard.tsx`
2. Integrate Mapbox map
3. Implement click-to-select
4. Add address geocoding
5. Add address search

### Phase 4: Backend Integration
1. Create `/api/properties/create` endpoint
2. Test property creation
3. Test file upload to new property
4. Handle errors

### Phase 5: Property Creation Flow
1. Implement "Create Property" button
2. Create property with location
3. Upload files to property
4. Handle progress and errors
5. Navigate to map on success

### Phase 6: Polish & Testing
1. Add loading states
2. Add error handling
3. Add success animations
4. Test responsive design
5. Test edge cases

---

## 12. Questions & Clarifications Needed

1. **File Upload Timing**:
   - Should files be uploaded immediately when added, or only when "Create Property" is clicked?
   - **Recommendation**: Store in state, upload after property creation

2. **Location Requirement**:
   - Is location selection required, or can property be created with just files?
   - **Recommendation**: Require location (property needs coordinates)

3. **File Requirements**:
   - Minimum number of files required?
   - Maximum number of files?
   - File size limits?
   - File type restrictions?

4. **Address Handling**:
   - Should user be able to manually enter address, or only select on map?
   - **Recommendation**: Both - search bar + map click

5. **Success Flow**:
   - After creation, should user:
     - Stay on workflow screen?
     - Navigate to map view?
     - Navigate to property details panel?
   - **Recommendation**: Navigate to map with property selected

6. **Error Recovery**:
   - If property creation succeeds but file upload fails, should property still be created?
   - **Recommendation**: Yes, allow retry of file uploads

---

## 13. Technical Considerations

### 13.1 Mapbox Token
- Reuse existing `VITE_MAPBOX_TOKEN`
- Ensure token is available in new component

### 13.2 File Storage
- Files stored temporarily in component state
- Consider memory limits for large files
- Consider chunked upload for very large files

### 13.3 Address Geocoding
- Use Mapbox Geocoding API (reverse geocode)
- Cache addresses to reduce API calls
- Handle geocoding failures gracefully

### 13.4 Property ID Generation
- Backend generates UUID
- Frontend can generate temporary ID for file tracking

### 13.5 Concurrent Uploads
- Upload files sequentially or in parallel?
- **Recommendation**: Sequential to avoid overwhelming backend

---

## 14. Testing Checklist

- [ ] "New Project" card click opens workflow
- [ ] Background color is correct (#D8CBBD)
- [ ] Cards are centered and properly sized
- [ ] File drag & drop works
- [ ] File selection works
- [ ] File removal works
- [ ] Map loads correctly
- [ ] Map click selects location
- [ ] Address search works
- [ ] Address geocoding works
- [ ] Property creation API works
- [ ] File upload to new property works
- [ ] Progress tracking works
- [ ] Error handling works
- [ ] Success navigation works
- [ ] Responsive design works
- [ ] Close button works
- [ ] Cancel button works

---

## 15. Future Enhancements (Post-MVP)

1. **Address Autocomplete**: As user types, show suggestions
2. **File Preview**: Show thumbnails/previews before upload
3. **Batch Upload**: Upload multiple files simultaneously
4. **Property Details**: Allow adding property details (type, bedrooms, etc.) before creation
5. **Template Selection**: Pre-fill property details from templates
6. **Draft Saving**: Save incomplete workflows to localStorage
7. **Undo/Redo**: Allow undoing file removals or location changes

---

## Summary

This plan provides a comprehensive roadmap for implementing the new property pin creation workflow. The key components are:

1. **UI**: 2-card layout on beige background (#D8CBBD)
2. **Left Card**: File upload with drag & drop
3. **Right Card**: Map-based location selection
4. **Flow**: Upload files → Select location → Create property → Upload files to property → Navigate to map
5. **Integration**: Seamless connection with existing RecentProjectsSection and MainContent

The implementation should be done in phases, starting with basic structure and progressively adding functionality.

