import React, { useState, useCallback, useEffect } from 'react';
import BaseLayout from './BaseLayout';

const Data = () => {
  const [user, setUser] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // Fetch user data when the component mounts
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
  }, []); // Empty dependency array means this runs once on mount

  const handleFileUpload = (files) => {
    setUploadedFiles(prevFiles => [...prevFiles, ...files]);
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
      handleFileUpload(files);
    }
  }, []);

  const onFileSelect = (event) => {
    const files = Array.from(event.target.files);
    if (files && files.length > 0) {
      handleFileUpload(files);
    }
  };

  const handleUpload = async () => {
    if (uploadedFiles.length === 0) {
      alert("Please select files to upload first.");
      return;
    }

    const formData = new FormData();
    uploadedFiles.forEach(file => {
      formData.append('files', file);
    });

    // Assuming user and business IDs are available in the user prop.
    if (user?.id) formData.append('user_id', user.id);
    if (user?.business_id) formData.append('business_id', user.business_id);
    else {
      // It's possible the user object doesn't have a business_id.
      // We will look for company_name as a fallback.
      const companyId = user?.company_name || 'default-business';
      formData.append('business_id', companyId);
    }


    try {
      // This sends the data to YOUR backend.
      // We'll need to create this '/api/upload-files' endpoint in Python.
      const response = await fetch('/api/upload-files', {
        method: 'POST',
        body: formData, // No 'Content-Type' header needed, browser sets it for FormData
      });

      if (response.ok) {
        const result = await response.json();
        alert('Upload successful!');
        console.log('Server response:', result);
        setUploadedFiles([]); // Clear files after successful upload
      } else {
        const errorData = await response.json();
        alert(`Upload failed: ${errorData.message || response.statusText}`);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('An error occurred during upload. See console for details.');
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

  const mapPlaceholderStyle = {
    width: '100%',
    maxWidth: '960px',
    height: '400px',
    backgroundColor: '#e0e0e0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '10px',
    marginBottom: '20px',
    color: '#666'
  };

  const dataRowsContainerStyle = {
    width: '100%',
    maxWidth: '960px',
    maxHeight: '300px',
    overflowY: 'auto',
    border: '1px solid #ddd',
    borderRadius: '10px',
    padding: '10px'
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
              onChange={onFileSelect}
              style={fileInputStyle}
            />
            <p>Drag & drop files here, or click to select files</p>
          </div>
          
          {uploadedFiles.length > 0 && (
            <div style={{width: '100%', maxWidth: '960px', marginBottom: '20px'}}>
              <h3>Uploaded Files:</h3>
              <ul>
                {uploadedFiles.map((file, index) => (
                  <li key={index}>
                    {file.name} - {file.size} bytes
                  </li>
                ))}
              </ul>
              <button onClick={handleUpload} style={uploadButtonStyle}>
                Upload
              </button>
            </div>
          )}

          <div style={mapPlaceholderStyle}>
            <span>Google Map Placeholder</span>
          </div>

          <div style={dataRowsContainerStyle}>
            <h3>Data Rows</h3>
            {/* Placeholder for data rows */}
            {Array.from({ length: 40 }).map((_, index) => (
              <div key={index} style={{ padding: '10px', borderBottom: '1px solid #eee' }}>
                Row {index + 1} of data
              </div>
            ))}
          </div>
        </div>
      </div>
    </BaseLayout>
  );
};

export default Data;
