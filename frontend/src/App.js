import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './components/Dashboard';
import CurrentAppraisal from './components/CurrentAppraisal';
import CreateAppraisal from './components/CreateAppraisal';
import Login from './components/Login';
import Signup from './components/Signup';
import Landing from './components/Landing';
import './App.css';

function App() {
  return (
    <Router>
      <div className="App">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/sign-up" element={<Signup />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/appraisal/:id" element={<CurrentAppraisal />} />
          <Route path="/create-appraisal" element={<CreateAppraisal />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App; 