import React, { useState, useCallback, useEffect } from 'react';
import BaseLayout from './BaseLayout';

const Data = () => {
  const [user, setUser] = useState(null);
  const [filesToUpload, setFilesToUpload] = useState([]);
  const [uploadedDocuments, setUploadedDocuments] = useState([]);
  const [uploadProgress, setUploadProgress] = useState({});
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');

  const fetchDocuments = async () => {
    try {
        const response = await fetch('/api/documents');
        if (response.ok) {
            const data = await response.json();
            setUploadedDocuments(data);
        } else {
            console.error('Failed to fetch documents');
        }
    } catch (error) {
        console.error('Error fetching documents:', error);
    }
  };

  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const response = await fetch('/api/dashboard');
        if (!response.ok) {
          throw new Error('Failed to fetch user data');
        }
        const data = await response.json();
        setUser(data.user);
      } catch (err) {
        setError(err.message);
        console.error("Error fetching user data:", err);
      }
    };

    fetchUserData();
    fetchDocuments();
  }, []); 

  const handleDelete = async (documentId) => {
    if (window.confirm('Are you sure you want to delete this file?')) {
        const originalDocuments = [...uploadedDocuments];
        
        // Optimistically remove the document from the UI
        setUploadedDocuments(prevDocuments => prevDocuments.filter(doc => doc.id !== documentId));

        try {
            const response = await fetch(`/api/document/${documentId}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                // If the deletion fails, roll back the UI change
                const errorData = await response.json();
                alert(`Failed to delete file: ${errorData.error}`);
                setUploadedDocuments(originalDocuments); // Rollback
            }
            // If successful, the UI is already updated, so we do nothing.

        } catch (err) {
            alert(`An error occurred: ${err.message}`);
            // Rollback on network error
            setUploadedDocuments(originalDocuments);
        }
    }
  };

  const handleFileSelect = (newFiles) => {
    const filesWithStatus = newFiles.map(file => ({
      file,
      status: 'pending', // pending, uploading, success, error
      id: `${file.name}-${file.lastModified}`
    }));
    setFilesToUpload(prevFiles => [...prevFiles, ...filesWithStatus]);
  };

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((event) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback((event) => {
    event.preventDefault();
    setIsDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files && files.length > 0) {
      handleFileSelect(files);
    }
  }, []);

  const onFileSelectChange = (event) => {
    const files = Array.from(event.target.files);
    if (files && files.length > 0) {
      handleFileSelect(files);
    }
  };

  const handleUpload = async () => {
    if (filesToUpload.length === 0) {
      alert("Please select files to upload first.");
      return;
    }

    for (const fileObj of filesToUpload) {
      if (fileObj.status === 'success' || fileObj.status === 'uploading') {
        continue; // Skip already uploaded or currently uploading files
      }

      const { file, id } = fileObj;
      setUploadProgress(prev => ({ ...prev, [id]: { status: 'uploading', percentage: 50 } }));

      try {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/upload-file', {
          method: 'POST',
          body: formData,
          // No 'Content-Type' header, browser sets it for FormData
        });

        if (response.ok) {
          setUploadProgress(prev => ({ ...prev, [id]: { status: 'success', percentage: 100 } }));
          setFilesToUpload(prev => prev.map(f => f.id === id ? { ...f, status: 'success' } : f));
          fetchDocuments(); // Refresh the list of uploaded documents
        } else {
          const errorData = await response.json();
          throw new Error(errorData.error || `Upload failed with status: ${response.status}`);
        }
      } catch (err) {
        console.error('Upload error for file:', file.name, err);
        setUploadProgress(prev => ({ ...prev, [id]: { status: 'error', percentage: 0, error: err.message } }));
        setFilesToUpload(prev => prev.map(f => f.id === id ? { ...f, status: 'error' } : f));
      }
    }
  };

  const pageContainerStyle = {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
    overflowY: 'auto',
    padding: '20px',
  };

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    maxWidth: '960px',
    fontFamily: 'sans-serif'
  };

  const dropzoneStyle = {
    border: `2px dashed ${isDragging ? 'blue' : '#ccc'}`,
    borderRadius: '10px',
    padding: '40px',
    textAlign: 'center',
    cursor: 'pointer',
    width: '100%',
    maxWidth: '960px',
    marginBottom: '20px',
    backgroundColor: isDragging ? '#f0f8ff' : '#fafafa'
  };

  const dataRowsContainerStyle = {
    width: '100%',
    maxWidth: '960px',
    maxHeight: '300px',
    overflowY: 'auto',
    border: '1px solid #ddd',
    borderRadius: '10px',
    padding: '10px',
    marginBottom: '20px'
  };

  const fileInputStyle = {
    display: 'none'
  };

  const uploadButtonStyle = {
    padding: '10px 20px',
    fontSize: '16px',
    backgroundColor: '#007bff',
    color: 'white',
    border: 'none',
    borderRadius: '5px',
    cursor: 'pointer',
    marginTop: '10px',
    display: 'block'
  };
  
  if (error) {
    return <BaseLayout><div style={{ padding: '20px', color: 'red' }}>Error: {error}</div></BaseLayout>;
  }

  if (!user) {
    return <BaseLayout><div style={{ padding: '20px' }}>Loading user data...</div></BaseLayout>;
  }

  return (
    <BaseLayout user={user}>
      <div style={pageContainerStyle}>
        <div style={containerStyle}>
          <div 
            style={dropzoneStyle}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => document.getElementById('fileInput').click()}
          >
            <input
              id="fileInput"
              type="file"
              multiple
              onChange={onFileSelectChange}
              style={fileInputStyle}
            />
            <p>Drag & drop files here, or click to select files</p>
          </div>
          
          <div style={dataRowsContainerStyle}>
            {filesToUpload.length === 0 ? (
              <p>No files selected.</p>
            ) : (
              filesToUpload.map(({ file, id, status }) => {
                const progress = uploadProgress[id] || {};
                return (
                  <div key={id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0' }}>
                    <span>{file.name}</span>
                    <span>
                      {status === 'pending' && 'Pending...'}
                      {progress.status === 'uploading' && `Uploading... ${progress.percentage}%`}
                      {status === 'success' && '✅ Uploaded'}
                      {status === 'error' && `❌ Error`}
                    </span>
                  </div>
                );
              })
            )}
          </div>

          <button onClick={handleUpload} style={uploadButtonStyle} disabled={filesToUpload.every(f => f.status === 'success' || f.status === 'uploading')}>
            Upload Selected Files
          </button>

          <div style={{...dataRowsContainerStyle, marginTop: '20px'}}>
            <h2>Uploaded Files</h2>
            {uploadedDocuments.length === 0 ? (
              <p>No documents uploaded yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th style={{textAlign: 'left'}}>Filename</th>
                    <th style={{textAlign: 'center'}}>Status</th>
                    <th style={{textAlign: 'right'}}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                {uploadedDocuments.map((doc) => (
                  <tr key={doc.id}>
                    <td>{doc.original_filename}</td>
                    <td>{doc.status}</td>
                    <td><button onClick={() => handleDelete(doc.id)}>Delete</button></td>
                  </tr>
                ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </BaseLayout>
  );
};

export default Data;
