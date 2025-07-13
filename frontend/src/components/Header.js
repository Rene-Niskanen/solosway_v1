import React from 'react';

const Header = ({ appraisal }) => {
  return (
    <>
      <div className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200" style={{ height: '64px' }}>
        <div className="flex items-center justify-between h-16 px-6">
          <div className="flex items-center gap-4">
            <a href="/dashboard" className="font-bold text-xl text-[#101419]">Home</a>
            <a href="/create-appraisal" className="text-sm font-medium text-[#101419] hover:text-blue-700">+ New Appraisal</a>
            <a href="/recent-appraisals" className="text-sm font-medium text-[#101419] hover:text-blue-700">Recent</a>
            <a href="/reports" className="text-sm font-medium text-[#101419] hover:text-blue-700">Reports</a>
          </div>
          <div className="flex items-center gap-4">
            <a href="/profile" className="text-sm font-medium text-[#101419] hover:text-blue-700">Profile</a>
          </div>
        </div>
      </div>
      {/* Subnav with property address, only if appraisal is present */}
      {appraisal && (
        <div className="fixed top-[64px] left-0 right-0 z-40 bg-[#f8fafc] border-b border-gray-200" style={{ height: '56px' }}>
          <div className="flex flex-wrap justify-between items-center gap-2 px-6 h-14">
            <p className="text-[#101419] tracking-light text-[22px] font-bold leading-tight min-w-60 my-0">
              {appraisal?.address || 'Loading...'}
            </p>
            <div></div> {/* Empty to keep spacing */}
          </div>
        </div>
      )}
    </>
  );
};

export default Header; 