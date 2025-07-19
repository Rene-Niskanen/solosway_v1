import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';

const AdminProtectedRoute = ({ user, isLoading }) => {
  if (isLoading) {
    // Show a loading indicator while user data is being fetched
    return <div>Loading...</div>;
  }

  if (!user || user.role !== 'ADMIN') {
    // If there's no user or the user is not an admin, redirect them
    return <Navigate to="/dashboard" />;
  }

  // If the user is an admin, render the child routes
  return <Outlet />;
};

export default AdminProtectedRoute; 