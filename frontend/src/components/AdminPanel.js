import React, { useState, useEffect } from 'react';
import BaseLayout from './BaseLayout';

const AdminPanel = () => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const [inviteEmail, setInviteEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Fetch user data on component mount to check role
  useEffect(() => {
    const fetchUserData = async () => {
      try {
        const response = await fetch('/api/dashboard');
        if (!response.ok) {
          throw new Error('Could not fetch user data');
        }
        const data = await response.json();
        setUser(data.user);
      } catch (err) {
        setError(err.message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchUserData();
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
  
  // Pass user and isLoading to BaseLayout to handle header display
  // BaseLayout can also be used to wrap the entire admin section
  return (
    <BaseLayout user={user}>
      <div className="p-8">
        <h1 className="text-2xl font-bold mb-4">Admin Panel</h1>
        <div className="max-w-md bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Invite New Client</h2>
          <form onSubmit={handleInvite}>
            <div className="mb-4">
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">Client Email</label>
              <input
                type="email"
                id="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
            <div className="mb-4">
              <label htmlFor="companyName" className="block text-sm font-medium text-gray-700">Company Name</label>
              <input
                type="text"
                id="companyName"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                required
                className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>
            <button
              type="submit"
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Send Invitation
            </button>
          </form>
          {message && <p className="mt-4 text-sm text-green-600 bg-green-100 p-3 rounded-md">{message}</p>}
          {error && <p className="mt-4 text-sm text-red-600 bg-red-100 p-3 rounded-md">{error}</p>}
        </div>
      </div>
    </BaseLayout>
  );
};

export default AdminPanel; 