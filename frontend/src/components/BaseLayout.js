import React from 'react';

// Simple avatar fallback
const Avatar = ({ src, alt, fallback }) => (
  <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-indigo-200 shadow-sm flex items-center justify-center bg-gray-100">
    {src ? (
      <img src={src} alt={alt} className="w-full h-full object-cover" />
    ) : (
      <span className="text-lg font-bold text-indigo-700">{fallback}</span>
    )}
  </div>
);

export function MainHeader({ user }) {
  return (
    <header className="bg-white border-b px-6 py-4 flex-shrink-0 z-30">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-8">
          <h1 className="text-2xl font-bold text-blue-600">Solosway</h1>
          <nav className="flex space-x-6">
            <a href="/dashboard" className="text-gray-600 hover:text-gray-900">Dashboard</a>
            <a href="/create-appraisal" className="text-gray-900 font-medium">New Appraisal</a>
            <a href="/data" className="text-gray-600 hover:text-gray-900">Data</a>
          </nav>
        </div>
        <div className="flex items-center space-x-4">
          <button className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-100 transition" title="Settings">
            <svg viewBox="0 0 512 512" fill="currentColor" className="w-6 h-6 text-gray-600">
              <path d="M487.4 315.7l-42.2-24.4c2.7-15.2 2.7-31 0-46.2l42.2-24.4c15.1-8.7 21.1-27.6 13.7-43.2l-43.1-74.6c-7.5-12.9-23.5-18.1-37-12.1l-42.2 17.9c-12.1-9.4-25.1-17.1-39.1-22.8l-6.3-45.1C332.7 13.1 319.6 0 303.7 0h-95.4c-15.9 0-29 13.1-30.5 29.7l-6.3 45.1c-14 5.7-27 13.4-39.1 22.8l-42.2-17.9c-13.5-5.7-29.5-.8-37 12.1l-43.1 74.6c-7.5 12.9-3.5 30.1 13.7 43.2l42.2 24.4c-2.7 15.2-2.7 31 0 46.2l-42.2 24.4c-15.1 8.7-21.1 27.6-13.7 43.2l43.1 74.6c7.5 12.9 23.5 18.1 37 12.1l42.2-17.9c12.1 9.4 25.1 17.1 39.1 22.8l6.3 45.1c1.5 16.6 14.6 29.7 30.5 29.7h95.4c15.9 0 29-13.1 30.5-29.7l6.3-45.1c14-5.7 27-13.4 39.1-22.8l42.2 17.9c13.5 5.7 29.5.8 37-12.1l43.1-74.6c7.5-12.9 1.5-34.5-13.7-43.2zM256 336c-44.1 0-80-35.9-80-80s35.9-80 80-80 80 35.9 80 80-35.9 80-80 80z"/>
            </svg>
          </button>
          <Avatar
            src={user?.id ? `https://randomuser.me/api/portraits/men/${user.id % 100}.jpg` : null}
            alt="Profile"
            fallback={user?.first_name ? user.first_name[0] : 'U'}
          />
        </div>
      </div>
    </header>
  );
}

export default function BaseLayout({ children, user }) {
  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <MainHeader user={user} />
      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">{children}</div>
    </div>
  );
} 