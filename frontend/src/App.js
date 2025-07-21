import React, { useState, useEffect, useMemo } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import CurrentAppraisal from './components/CurrentAppraisal';
import CreateAppraisal from './components/CreateAppraisal';
import Login from './components/Login';
import Landing from './components/Landing';
import Data from './components/Data';
import BookDemo from './components/BookDemo';
import AdminProtectedRoute from './components/AdminProtectedRoute';
import AdminPanel from './components/AdminPanel';
import './App.css';

function App() {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/dashboard');
        if (response.ok) {
          const data = await response.json();
          setUser(data.user);
        }
      } catch (error) {
        console.error('Failed to fetch user:', error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchUser();
  }, []);

  const memoizedUser = useMemo(() => user, [user?.id]);


  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/book-demo" element={<BookDemo />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/appraisal/:id" element={<CurrentAppraisal />} />
          <Route path="/create-appraisal" element={<CreateAppraisal />} />
          <Route path="/data" element={<Data />} />

          {/* Admin Routes */}
          <Route element={<AdminProtectedRoute user={memoizedUser} isLoading={isLoading} />}>
            <Route path="/admin/users" element={<AdminPanel />} />
            {/* Add other admin routes here in the future */}
          </Route>
        </Routes>
      </div>
    </Router>
  );
}

export default App; 