  // Render different sections content
  const renderContent = () => {
    switch (activeSection) {
      case 'overview':
        return (
          <div className="p-8 text-white overflow-y-auto h-full scrollbar-thin custom-scrollbar">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl font-light tracking-tight mb-6 text-white/90">Property Overview</h2>
              
              {/* Image - Hero Style */}
              <div className="w-full h-72 rounded-2xl overflow-hidden mb-8 bg-gray-800 relative shadow-2xl group">
                 <img 
                   src={getPropertyImage()} 
                   alt={displayProperty.address} 
                   className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                   onError={(e) => (e.target as HTMLImageElement).src = '/property-1.png'}
                 />
                 <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent opacity-80" />
                 <div className="absolute bottom-0 left-0 right-0 p-6">
                   <h3 className="text-2xl font-semibold text-white tracking-tight drop-shadow-lg">{displayProperty.address}</h3>
                   <p className="text-white/70 text-sm mt-1 font-medium tracking-wide uppercase">{displayProperty.postcode || 'London, UK'}</p>
                 </div>
              </div>

              {/* Key Stats - Minimalist Cards */}
              <div className="grid grid-cols-3 gap-4 mb-8">
                 <div className="bg-white/5 backdrop-blur-md p-5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors flex flex-col items-center justify-center group">
                   <Bed size={24} className="text-blue-400 mb-2 group-hover:scale-110 transition-transform"/>
                   <span className="text-2xl font-bold tracking-tight">{displayProperty.bedrooms || 0}</span>
                   <span className="text-xs text-gray-400 uppercase tracking-wider font-medium mt-1">Bedrooms</span>
                 </div>
                 <div className="bg-white/5 backdrop-blur-md p-5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors flex flex-col items-center justify-center group">
                   <Bath size={24} className="text-blue-400 mb-2 group-hover:scale-110 transition-transform"/>
                   <span className="text-2xl font-bold tracking-tight">{displayProperty.bathrooms || 0}</span>
                   <span className="text-xs text-gray-400 uppercase tracking-wider font-medium mt-1">Bathrooms</span>
                 </div>
                 <div className="bg-white/5 backdrop-blur-md p-5 rounded-2xl border border-white/10 hover:bg-white/10 transition-colors flex flex-col items-center justify-center group">
                   <Ruler size={24} className="text-blue-400 mb-2 group-hover:scale-110 transition-transform"/>
                   <span className="text-2xl font-bold tracking-tight">{displayProperty.square_feet?.toLocaleString() || 0}</span>
                   <span className="text-xs text-gray-400 uppercase tracking-wider font-medium mt-1">Sq Ft</span>
                 </div>
              </div>

              {/* Description - Clean Typography */}
              <div className="bg-white/5 backdrop-blur-md p-6 rounded-2xl border border-white/10">
                <h4 className="text-xs font-bold text-blue-400 mb-4 uppercase tracking-widest">Description</h4>
                <p className="text-gray-300 text-sm leading-loose whitespace-pre-line font-light tracking-wide">
                  {displayProperty.summary || displayProperty.notes || "No description available."}
                </p>
              </div>
            </div>
          </div>
        );
      
      case 'details':
        return (
          <div className="p-8 text-white overflow-y-auto h-full scrollbar-thin custom-scrollbar">
             <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl font-light tracking-tight mb-8 text-white/90">Property Details</h2>
              <div className="bg-white/5 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden shadow-xl">
                <div className="divide-y divide-white/5">
                  <div className="p-5 grid grid-cols-2 items-center hover:bg-white/5 transition-colors">
                    <span className="text-gray-400 text-sm font-medium">Property Type</span>
                    <span className="text-white font-medium text-right">{displayProperty.property_type || 'Unknown'}</span>
                  </div>
                  <div className="p-5 grid grid-cols-2 items-center hover:bg-white/5 transition-colors">
                    <span className="text-gray-400 text-sm font-medium">Tenure</span>
                    <span className="text-white font-medium text-right">{displayProperty.tenure || 'Unknown'}</span>
                  </div>
                  <div className="p-5 grid grid-cols-2 items-center hover:bg-white/5 transition-colors">
                    <span className="text-gray-400 text-sm font-medium">EPC Rating</span>
                    <span className="text-white font-medium text-right px-3 py-1 bg-green-500/20 text-green-400 rounded-full inline-block w-fit justify-self-end">{displayProperty.epc_rating || 'N/A'}</span>
                  </div>
                  <div className="p-5 grid grid-cols-2 items-center hover:bg-white/5 transition-colors">
                    <span className="text-gray-400 text-sm font-medium">Last Transaction</span>
                    <span className="text-white font-medium text-right">
                      {displayProperty.transaction_date ? new Date(displayProperty.transaction_date).toLocaleDateString() : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'financials':
        return (
          <div className="p-8 text-white overflow-y-auto h-full scrollbar-thin custom-scrollbar">
             <div className="max-w-3xl mx-auto">
              <h2 className="text-3xl font-light tracking-tight mb-8 text-white/90">Financial Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* Valuation Card */}
                <div className="bg-white/5 backdrop-blur-md p-6 rounded-2xl border border-white/10 hover:border-blue-500/30 transition-colors shadow-xl">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 bg-green-500/20 rounded-xl">
                      <DollarSign size={20} className="text-green-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-white tracking-tight">Valuation</h3>
                  </div>
                  <div className="space-y-6">
                    <div>
                      <span className="block text-xs text-gray-500 uppercase tracking-wider font-medium mb-1.5">Sold Price</span>
                      <span className="text-3xl font-light text-white tracking-tight">
                        {displayProperty.soldPrice ? `£${displayProperty.soldPrice.toLocaleString()}` : 'N/A'}
                      </span>
                    </div>
                    <div className="pt-4 border-t border-white/5">
                      <span className="block text-xs text-gray-500 uppercase tracking-wider font-medium mb-1.5">Asking Price</span>
                      <span className="text-xl text-gray-300 font-light">
                        {displayProperty.askingPrice ? `£${displayProperty.askingPrice.toLocaleString()}` : 'N/A'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Rental Card */}
                <div className="bg-white/5 backdrop-blur-md p-6 rounded-2xl border border-white/10 hover:border-blue-500/30 transition-colors shadow-xl">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="p-2.5 bg-blue-500/20 rounded-xl">
                      <ArrowUp size={20} className="text-blue-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-white tracking-tight">Rental Performance</h3>
                  </div>
                  <div className="space-y-6">
                    <div>
                      <span className="block text-xs text-gray-500 uppercase tracking-wider font-medium mb-1.5">Rent (PCM)</span>
                      <span className="text-3xl font-light text-white tracking-tight">
                        {displayProperty.rentPcm ? `£${displayProperty.rentPcm.toLocaleString()}` : 'N/A'}
                      </span>
                    </div>
                    <div className="pt-4 border-t border-white/5">
                      <span className="block text-xs text-gray-500 uppercase tracking-wider font-medium mb-1.5">Yield</span>
                      <span className="text-2xl font-medium text-green-400">
                        {yieldPercentage ? `${yieldPercentage}%` : 'N/A'}
                      </span>
                    </div>
                    {lettingInfo && (
                      <div className="pt-4 border-t border-white/5">
                        <span className="block text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">Status</span>
                        <span className="text-xs font-bold text-blue-300 bg-blue-900/40 px-3 py-1.5 rounded-full border border-blue-500/20 inline-block tracking-wide">
                          {lettingInfo}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case 'documents':
        return (
          <div className="h-full flex flex-col relative bg-gradient-to-b from-[#1E1E1E] to-[#121212] overflow-hidden">
            <div className="p-6 z-10 flex justify-between items-center bg-gradient-to-b from-[#1E1E1E] to-transparent">
              <h2 className="text-3xl font-light tracking-tight text-white/90">Documents</h2>
              
              {/* Search & Actions */}
              <div className="flex items-center gap-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={filesSearchQuery}
                    onChange={(e) => setFilesSearchQuery(e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-full py-1.5 pl-9 pr-4 text-sm text-white focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all w-48"
                  />
                </div>
                
                {/* Upload button - always visible, even with 0 documents */}
                <button 
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-full transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-600/30 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!property?.id) {
                      alert('Please select a property first');
                      return;
                    }
                    fileInputRef.current?.click();
                  }}
                  disabled={uploading || !property?.id}
                  title={!property?.id ? "Please select a property first" : "Upload document"}
                >
                  {uploading ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload size={14} strokeWidth={2.5} />
                      <span>Upload</span>
                    </>
                  )}
                </button>
                
                <button
                  onClick={() => {
                    setIsSelectionMode(!isSelectionMode);
                    if (isSelectionMode) setSelectedDocumentIds(new Set());
                  }}
                  className={`p-2 rounded-full transition-all ${
                    isSelectionMode ? 'bg-white text-black' : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                  title="Select Mode"
                >
                  <CheckSquare size={18} />
                </button>
              </div>
            </div>
            
            {/* Filing Cabinet View - Restored */}
            <div className="flex-1 relative overflow-y-auto scrollbar-thin custom-scrollbar px-4 pb-10">
               {/* Delete Zone - Appears when dragging */}
               <AnimatePresence>
                  {isDraggingToDelete && draggedDocumentId && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="fixed bottom-8 right-8 z-[200] bg-red-500/90 backdrop-blur rounded-full p-5 shadow-2xl cursor-pointer border border-red-400/50"
                      onDragOver={handleDeleteZoneDragOver}
                      onDragLeave={handleDeleteZoneDragLeave}
                      onDrop={handleDeleteZoneDrop}
                      whileHover={{ scale: 1.1 }}
                    >
                      <Trash2 className="w-8 h-8 text-white" />
                    </motion.div>
                  )}
                </AnimatePresence>

               {filteredDocuments.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-500 p-10">
                  <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/5">
                    <FileText size={32} className="text-gray-600" />
                  </div>
                  <p className="text-lg font-medium text-gray-400 mb-1">No documents found</p>
                  <p className="text-sm mb-6 text-gray-600">Upload documents or adjust your search.</p>
                  <button 
                    className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-full transition-all shadow-lg shadow-blue-900/20 hover:shadow-blue-600/30 flex items-center gap-2"
                    onClick={() => {
                      if (!property?.id) {
                        alert('Please select a property first');
                        return;
                      }
                      fileInputRef.current?.click();
                    }}
                    disabled={!property?.id}
                    title={!property?.id ? "Please select a property first" : "Upload document"}
                  >
                    <Upload size={16} strokeWidth={2.5} />
                    <span>Upload Document</span>
                  </button>
                </div>
              ) : selectedCardIndex !== null ? (
                  <ExpandedCardView
                    selectedDoc={filteredDocuments[selectedCardIndex]}
                    onClose={() => setSelectedCardIndex(null)}
                    onDocumentClick={handleDocumentClick}
                  />
              ) : (
                <div 
                  className="relative w-full mx-auto max-w-2xl"
                  style={{ 
                    minHeight: '400px',
                    height: `${Math.max(500, 150 + (filteredDocuments.length * 50) + 60)}px`,
                    paddingTop: '120px', 
                    paddingBottom: '60px',
                    perspective: '1000px',
                    perspectiveOrigin: 'center top'
                  }}
                >
                  {/* SVG Clip Paths */}
                  <svg width="0" height="0" style={{ position: 'absolute' }}>
                    <defs>
                      {filteredDocuments.map((doc) => (
                        <clipPath key={doc.id} id={`roundedTrapezoid-${doc.id}`} clipPathUnits="objectBoundingBox">
                          <path d="M 0.02,0.05 
                                  Q 0.02,0 0.05,0 
                                  L 0.95,0 
                                  Q 0.98,0 0.98,0.05 
                                  L 0.96,0.97 
                                  Q 0.95,1 0.92,1 
                                  L 0.08,1 
                                  Q 0.05,1 0.04,0.97 
                                  Z" />
                        </clipPath>
                      ))}
                    </defs>
                  </svg>

                  {filteredDocuments.map((doc, index) => {
                    const fileType = (doc as any).file_type || '';
                    const fileName = doc.original_filename.toLowerCase();
                    const isPDF = fileType.includes('pdf') || fileName.endsWith('.pdf');
                    const isDOC = fileType.includes('word') || fileType.includes('document') || fileName.endsWith('.docx');
                    const isImage = fileType.includes('image') || fileName.match(/\.(jpg|jpeg|png|gif)$/i);
                    
                    const reverseIndex = filteredDocuments.length - 1 - index;
                    const bottomPosition = 60 + (reverseIndex * 48); // Increased spacing
                    const zIndex = index + 1;
                    const isHovered = hoveredCardIndex === index;
                    const isSelected = selectedDocumentIds.has(doc.id);
                    
                    return (
                      <motion.div
                        key={doc.id}
                        initial={{ opacity: 0, y: 50, rotateX: -20 }}
                        animate={{ opacity: 1, y: 0, rotateX: -10 }}
                        transition={{ duration: 0.4, delay: index * 0.05, type: "spring", stiffness: 100 }}
                        onMouseEnter={() => setHoveredCardIndex(index)}
                        onMouseLeave={() => setHoveredCardIndex(null)}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (isSelectionMode) {
                            const newSelected = new Set(selectedDocumentIds);
                            if (newSelected.has(doc.id)) newSelected.delete(doc.id);
                            else newSelected.add(doc.id);
                            setSelectedDocumentIds(newSelected);
                          } else {
                            if (selectedCardIndex === index) return;
                            setSelectedCardIndex(index);
                          }
                        }}
                        className="absolute left-[5%] w-[90%] h-[160px] cursor-pointer transform-gpu"
                        style={{
                          bottom: `${bottomPosition}px`,
                          zIndex: zIndex,
                          transformOrigin: 'center bottom',
                          transform: `rotateX(${isHovered ? -5 : -12}deg) translateY(${isHovered ? -15 : 0}px) scale(${isHovered ? 1.02 : 1})`,
                          filter: isHovered ? 'drop-shadow(0 20px 30px rgba(0,0,0,0.3))' : 'drop-shadow(0 10px 20px rgba(0,0,0,0.2))',
                          transition: 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'
                        }}
                        draggable
                        onDragStart={(e) => handleDocumentDragStart(e, doc)}
                        onDragEnd={handleDocumentDragEnd}
                      >
                         <div
                            className={`w-full h-full transition-all duration-300 ${
                              isSelected ? 'bg-blue-50 border-2 border-blue-500' : 
                              isHovered ? 'bg-[#f8f9fa]' : 'bg-[#f0f0f0]'
                            }`}
                            style={{
                              clipPath: `url(#roundedTrapezoid-${doc.id})`,
                              background: isSelected 
                                ? 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)' 
                                : 'linear-gradient(135deg, #ffffff 0%, #f3f4f6 100%)', // Classic white/grey file look
                              borderTop: '1px solid rgba(255,255,255,0.8)',
                            }}
                          >
                            {/* Top Tab/Label Area */}
                            <div className="px-8 pt-6 pb-2 flex items-center justify-between">
                                <div className="flex items-center gap-3 overflow-hidden">
                                  {isSelectionMode && (
                                    <div className="text-blue-600">
                                      {isSelected ? <CheckSquare size={20} fill="currentColor" className="text-white" /> : <Square size={20} className="text-gray-400" />}
                                    </div>
                                  )}
                                  
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-sm ${
                                    isPDF ? 'bg-red-500 text-white' : 
                                    isDOC ? 'bg-blue-500 text-white' : 
                                    isImage ? 'bg-purple-500 text-white' : 'bg-gray-500 text-white'
                                  }`}>
                                    {isPDF ? <FileText size={16} strokeWidth={3} /> : 
                                     isDOC ? <FileText size={16} strokeWidth={3} /> : 
                                     isImage ? <ImageIcon size={16} strokeWidth={3} /> : <File size={16} strokeWidth={3} />}
                                  </div>
                                  
                                  <div className="flex flex-col min-w-0">
                                    <h4 className="font-bold text-gray-800 truncate text-base leading-tight tracking-tight">
                                      {formatFileName(doc.original_filename)}
                                    </h4>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-600 uppercase tracking-wider">
                                        {(doc as any).file_type?.split('/')[1]?.toUpperCase() || 'FILE'}
                                      </span>
                                      <span className="text-[11px] text-gray-400 font-medium">
                                        {new Date(doc.created_at).toLocaleDateString()}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                                
                                {/* View Action */}
                                <div className={`opacity-0 transition-opacity duration-200 ${isHovered ? 'opacity-100' : ''}`}>
                                   <div className="bg-black/5 p-1.5 rounded-full">
                                     <ArrowUp size={16} className="text-gray-600 rotate-45" />
                                   </div>
                                </div>
                            </div>
                            
                            {/* File Preview / Content Hint */}
                            <div className="px-8 mt-2 opacity-50 grayscale">
                               <div className="h-2 w-3/4 bg-gray-300 rounded-full mb-2"></div>
                               <div className="h-2 w-1/2 bg-gray-300 rounded-full"></div>
                            </div>
                         </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
            
            {/* Hidden Input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            
            {/* Upload errors are now handled by UploadProgressBar component */}
            
             {/* Selection Floating Bar */}
             <AnimatePresence>
                {isSelectionMode && selectedDocumentIds.size > 0 && (
                  <motion.div 
                    initial={{ y: 100 }}
                    animate={{ y: 0 }}
                    exit={{ y: 100 }}
                    className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-white text-black px-6 py-3 rounded-full shadow-2xl flex items-center gap-4 z-50"
                  >
                    <span className="font-bold text-sm">{selectedDocumentIds.size} selected</span>
                    <div className="h-4 w-px bg-gray-300"></div>
                    <button 
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-red-500 hover:text-red-700 font-medium text-sm flex items-center gap-1.5"
                    >
                      <Trash2 size={14} />
                      Delete
                    </button>
                    <button 
                      onClick={() => setSelectedDocumentIds(new Set())}
                      className="text-gray-500 hover:text-black text-sm"
                    >
                      Clear
                    </button>
                  </motion.div>
                )}
             </AnimatePresence>
             
             {/* Delete Confirmation Dialog */}
             <AnimatePresence>
                {showDeleteConfirm && (
                  <div className="absolute inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
                    <motion.div 
                      initial={{ scale: 0.95, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.95, opacity: 0 }}
                      className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl"
                    >
                       <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Documents?</h3>
                       <p className="text-gray-500 text-sm mb-6">
                         Are you sure you want to delete {selectedDocumentIds.size} documents? This action cannot be undone.
                       </p>
                       <div className="flex justify-end gap-3">
                         <button 
                           onClick={() => setShowDeleteConfirm(false)}
                           className="px-4 py-2 text-gray-600 font-medium text-sm hover:bg-gray-100 rounded-lg transition-colors"
                         >
                           Cancel
                         </button>
                         <button 
                            onClick={async () => {
                              setIsDeleting(true);
                              try {
                                for (const docId of Array.from(selectedDocumentIds)) {
                                  await handleDeleteDocument(docId);
                                }
                                setSelectedDocumentIds(new Set());
                                setIsSelectionMode(false);
                                setShowDeleteConfirm(false);
                              } catch (e) {
                                console.error(e);
                              } finally {
                                setIsDeleting(false);
                              }
                            }}
                           className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white font-medium text-sm rounded-lg transition-colors"
                           disabled={isDeleting}
                         >
                           {isDeleting ? 'Deleting...' : 'Delete'}
                         </button>
                       </div>
                    </motion.div>
                  </div>
                )}
             </AnimatePresence>
          </div>
        );
      
      default:
        return null;
    }
  };

  if (!isVisible) return null;

  return createPortal(
    <AnimatePresence>
      {isVisible && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center font-sans" style={{ pointerEvents: 'auto' }}>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-md"
            onClick={onClose}
          />

          {/* Main Window - Glassmorphism */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="relative bg-[#121212]/95 backdrop-blur-xl rounded-3xl shadow-2xl flex overflow-hidden border border-white/10 ring-1 ring-white/5"
            style={{ 
              width: '950px', 
              height: '650px', 
              maxWidth: '95vw', 
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'row',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sidebar - Sleek Dark Gradient */}
            <div className="w-72 bg-gradient-to-b from-[#1A1A1A] to-[#121212] border-r border-white/5 flex flex-col flex-shrink-0 py-6">
              <div className="px-6 mb-8">
                <h1 className="text-xl font-bold text-white tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-gray-400">Property Details</h1>
              </div>
              
              <div className="flex-1 px-4 space-y-2">
                {SECTION_TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeSection === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveSection(tab.id)}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 group ${
                        isActive 
                          ? 'bg-blue-600/10 text-blue-400 shadow-inner border border-blue-500/20' 
                          : 'text-gray-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <Icon size={18} className={`transition-colors ${isActive ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-300'}`} />
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <div className="px-6 pt-6 border-t border-white/5">
                <div className="flex justify-between items-center text-xs font-medium text-gray-500">
                   <span>ID: {property.id}</span>
                   <span className={`px-2 py-0.5 rounded-full ${displayProperty.geocoding_status === 'manual' ? 'bg-purple-500/20 text-purple-400' : 'bg-green-500/20 text-green-400'}`}>
                     {displayProperty.geocoding_status === 'manual' ? 'Manual' : 'Auto'}
                   </span>
                </div>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex flex-col relative overflow-hidden bg-[#121212]/50">
              {/* Close Button - Floating */}
              <div className="absolute top-6 right-6 z-50">
                <button 
                  onClick={onClose}
                  className="p-2 bg-black/20 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-all border border-white/5 hover:border-white/20 backdrop-blur-sm"
                >
                  <X size={20} />
                </button>
              </div>
              
              {renderContent()}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};
