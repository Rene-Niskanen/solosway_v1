import React, { useState, useEffect } from 'react';
import BaseLayout from './BaseLayout';

const AdminPanel = () => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [showCreateUser, setShowCreateUser] = useState(false);
  
  // Invite user form
  const [inviteEmail, setInviteEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  // Create user form
  const [createUserData, setCreateUserData] = useState({
    email: '',
    first_name: '',
    company_name: '',
    password: '',
    role: 'USER'
  });

  // Fetch user data and users list on component mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch current user data
        const userResponse = await fetch('/api/dashboard');
        if (!userResponse.ok) {
          throw new Error('Could not fetch user data');
        }
        const userData = await userResponse.json();
        setUser(userData.user);
        
        // Fetch users list
        const usersResponse = await fetch('/admin/users');
        if (usersResponse.ok) {
          const usersData = await usersResponse.json();
          setUsers(usersData);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleInvite = async (e) => {
    e.preventDefault();
    setMessage('');
    setError('');

    try {
      const response = await fetch('/api/admin/invite-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, company_name: companyName }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'An unknown error occurred.');
      }

      setMessage(data.message + ` (Link: ${data.registration_link})`);
      setInviteEmail('');
      setCompanyName('');

    } catch (err) {
      setError(err.message);
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');

    try {
      const response = await fetch('/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createUserData),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to create user');
      }

      setMessage(data.message);
      setCreateUserData({
        email: '',
        first_name: '',
        company_name: '',
        password: '',
        role: 'USER'
      });
      setShowCreateUser(false);
      
      // Refresh users list
      const usersResponse = await fetch('/admin/users');
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setUsers(usersData);
      }

    } catch (err) {
      setError(err.message);
    }
  };

  const handleMakeAdmin = async (userId) => {
    if (!window.confirm('Are you sure you want to make this user an admin?')) {
      return;
    }

    try {
      const response = await fetch('/admin/make-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to promote user');
      }

      setMessage(data.message);
      
      // Refresh users list
      const usersResponse = await fetch('/admin/users');
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setUsers(usersData);
      }

    } catch (err) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async (userId) => {
    if (!window.confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch('/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to delete user');
      }

      setMessage(data.message);
      
      // Refresh users list
      const usersResponse = await fetch('/admin/users');
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setUsers(usersData);
      }

    } catch (err) {
      setError(err.message);
    }
  };

  const refreshUsers = async () => {
    try {
      const usersResponse = await fetch('/admin/users');
      if (usersResponse.ok) {
        const usersData = await usersResponse.json();
        setUsers(usersData);
        setMessage('Users list refreshed');
      }
    } catch (err) {
      setError('Failed to refresh users list');
    }
  };
  
  if (isLoading) {
    return (
      <BaseLayout user={user}>
        <div className="p-8 flex items-center justify-center">
          <div className="text-lg">Loading...</div>
        </div>
      </BaseLayout>
    );
  }

  return (
    <BaseLayout user={user}>
      <div className="p-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreateUser(!showCreateUser)}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {showCreateUser ? 'Cancel' : 'Create User'}
            </button>
            <button
              onClick={refreshUsers}
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Messages */}
        {message && (
          <div className="mb-6 p-4 bg-green-100 border border-green-400 text-green-700 rounded-md">
            {message}
          </div>
        )}
        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-md">
            {error}
          </div>
        )}

        {/* Create User Form */}
        {showCreateUser && (
          <div className="mb-8 bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">Create New User</h2>
            <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="create-email" className="block text-sm font-medium text-gray-700">Email</label>
                <input
                  type="email"
                  id="create-email"
                  value={createUserData.email}
                  onChange={(e) => setCreateUserData({...createUserData, email: e.target.value})}
                  required
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label htmlFor="create-first-name" className="block text-sm font-medium text-gray-700">First Name</label>
                <input
                  type="text"
                  id="create-first-name"
                  value={createUserData.first_name}
                  onChange={(e) => setCreateUserData({...createUserData, first_name: e.target.value})}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label htmlFor="create-company" className="block text-sm font-medium text-gray-700">Company Name</label>
                <input
                  type="text"
                  id="create-company"
                  value={createUserData.company_name}
                  onChange={(e) => setCreateUserData({...createUserData, company_name: e.target.value})}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div>
                <label htmlFor="create-password" className="block text-sm font-medium text-gray-700">Password</label>
                <input
                  type="password"
                  id="create-password"
                  value={createUserData.password}
                  onChange={(e) => setCreateUserData({...createUserData, password: e.target.value})}
                  required
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
              <div className="md:col-span-2">
                <label htmlFor="create-role" className="block text-sm font-medium text-gray-700">Role</label>
                <select
                  id="create-role"
                  value={createUserData.role}
                  onChange={(e) => setCreateUserData({...createUserData, role: e.target.value})}
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="USER">User</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  Create User
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Invite User Form */}
        <div className="mb-8 bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Invite New Client</h2>
          <form onSubmit={handleInvite} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700">Client Email</label>
              <input
                type="email"
                id="invite-email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div>
              <label htmlFor="invite-company" className="block text-sm font-medium text-gray-700">Company Name</label>
              <input
                type="text"
                id="invite-company"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              />
            </div>
            <div className="md:col-span-2">
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                Send Invitation
              </button>
            </div>
          </form>
        </div>

        {/* Users Table */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-xl font-semibold">User Management</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {users.map((userItem) => (
                  <tr key={userItem.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{userItem.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{userItem.email}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{userItem.first_name || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{userItem.company_name || '-'}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        userItem.role === 'ADMIN' 
                          ? 'bg-blue-100 text-blue-800' 
                          : 'bg-gray-100 text-gray-800'
                      }`}>
                        {userItem.role}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        userItem.status === 'ACTIVE' 
                          ? 'bg-green-100 text-green-800'
                          : userItem.status === 'INVITED'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {userItem.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex gap-2">
                        {userItem.role === 'USER' && (
                          <button
                            onClick={() => handleMakeAdmin(userItem.id)}
                            className="text-green-600 hover:text-green-900 bg-green-100 px-3 py-1 rounded text-xs"
                          >
                            Make Admin
                          </button>
                        )}
                        {userItem.id !== user?.id && (
                          <button
                            onClick={() => handleDeleteUser(userItem.id)}
                            className="text-red-600 hover:text-red-900 bg-red-100 px-3 py-1 rounded text-xs"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </BaseLayout>
  );
};

export default AdminPanel; 