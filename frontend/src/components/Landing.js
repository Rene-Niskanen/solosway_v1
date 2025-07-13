import React from 'react';
import { Link } from 'react-router-dom';

const Landing = () => (
  <div
    className="bg-gray-50 group/design-root"
    style={{ fontFamily: "Inter, 'Noto Sans', sans-serif" }}
  >
    <header className="flex items-center justify-between whitespace-nowrap border-b border-solid border-b-[#e9edf1] px-10 py-3">
      <div className="flex items-center gap-4 text-[#101419]">
        <div className="size-4">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M39.5563 34.1455V13.8546C39.5563 15.708 36.8773 17.3437 32.7927 18.3189C30.2914 18.916 27.263 19.2655 24 19.2655C20.737 19.2655 17.7086 18.916 15.2073 18.3189C11.1227 17.3437 8.44365 15.708 8.44365 13.8546V34.1455C8.44365 35.9988 11.1227 37.6346 15.2073 38.6098C17.7086 39.2069 20.737 39.5564 24 39.5564C27.263 39.5564 30.2914 39.2069 32.7927 38.6098C36.8773 37.6346 39.5563 35.9988 39.5563 34.1455Z"
              fill="currentColor"
            ></path>
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M10.4485 13.8519C10.4749 13.9271 10.6203 14.246 11.379 14.7361C12.298 15.3298 13.7492 15.9145 15.6717 16.3735C18.0007 16.9296 20.8712 17.2655 24 17.2655C27.1288 17.2655 29.9993 16.9296 32.3283 16.3735C34.2508 15.9145 35.702 15.3298 36.621 14.7361C37.3796 14.246 37.5251 13.9271 37.5515 13.8519C37.5287 13.7876 37.4333 13.5973 37.0635 13.2931C36.5266 12.8516 35.6288 12.3647 34.343 11.9175C31.79 11.0295 28.1333 10.4437 24 10.4437C19.8667 10.4437 16.2099 11.0295 13.657 11.9175C12.3712 12.3647 11.4734 12.8516 10.9365 13.2931C10.5667 13.5973 10.4713 13.7876 10.4485 13.8519ZM37.5563 18.7877C36.3176 19.3925 34.8502 19.8839 33.2571 20.2642C30.5836 20.9025 27.3973 21.2655 24 21.2655C20.6027 21.2655 17.4164 20.9025 14.7429 20.2642C13.1498 19.8839 11.6824 19.3925 10.4436 18.7877V34.1275C10.4515 34.1545 10.5427 34.4867 11.379 35.027C12.298 35.6207 13.7492 36.2054 15.6717 36.6644C18.0007 37.2205 20.8712 37.5564 24 37.5564C27.1288 37.5564 29.9993 37.2205 32.3283 36.6644C34.2508 36.2054 35.702 35.6207 36.621 35.027C37.4573 34.4867 37.5485 34.1546 37.5563 34.1275V18.7877ZM41.5563 13.8546V34.1455C41.5563 36.1078 40.158 37.5042 38.7915 38.3869C37.3498 39.3182 35.4192 40.0389 33.2571 40.5551C30.5836 41.1934 27.3973 41.5564 24 41.5564C20.6027 41.5564 17.4164 41.1934 14.7429 40.5551C12.5808 40.0389 10.6502 39.3182 9.20848 38.3869C7.84205 37.5042 6.44365 36.1078 6.44365 34.1455L6.44365 13.8546C6.44365 12.2684 7.37223 11.0454 8.39581 10.2036C9.43325 9.3505 10.8137 8.67141 12.343 8.13948C15.4203 7.06909 19.5418 6.44366 24 6.44366C28.4582 6.44366 32.5797 7.06909 35.657 8.13948C37.1863 8.67141 38.5667 9.3505 39.6042 10.2036C40.6278 11.0454 41.5563 12.2684 41.5563 13.8546Z"
              fill="currentColor"
            ></path>
          </svg>
        </div>
        <h2 className="text-[#101419] text-lg font-bold leading-tight tracking-[-0.015em]"></h2>
      </div>
      <div className="flex items-center gap-8">
        <div className="hidden md:flex items-center gap-9">
          <a className="text-[#101419] text-sm font-medium leading-normal" href="#">Product</a>
          <a className="text-[#101419] text-sm font-medium leading-normal" href="#">Solutions</a>
          <a className="text-[#101419] text-sm font-medium leading-normal" href="#">Resources</a>
          <a className="text-[#101419] text-sm font-medium leading-normal" href="#">Pricing</a>
        </div>
        <div className="flex gap-2">
          <Link
            to="/sign-up"
            className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-4 bg-[#d2e2f3] text-[#101419] text-sm font-bold leading-normal tracking-[0.015em]"
          >
            <span className="truncate">Get Started</span>
          </Link>
          <Link
            to="/login"
            className="flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 px-4 bg-[#e9edf1] text-[#101419] text-sm font-bold leading-normal tracking-[0.015em]"
          >
            <span className="truncate">Login</span>
          </Link>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-6 px-4 py-10">
        <div className="flex flex-col gap-8 md:flex-row">
          <div
            className="w-full h-auto min-h-60 bg-center bg-no-repeat aspect-video bg-cover rounded-xl md:w-1/2"
            style={{
              backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuDIraw6vVOEjDRVFTRdgjn8w0pQ1fn9BRLG-wPT-zh35gL3FOw3iQq0QzwIleXQuZXns6mfSF-t-WnOLCnk8GpWKjvG4b-BMr6aFVyEXeUJjmCM7z65htH5r-AeVHCLEeH7wyB1locERCtV2tyMtM_D7XTSBHPwfHORDHDX6nYfthkC7Argrg5R96Smhh375_tz_DUSclckN-sM-1CzI5puHt1MP3muKYDFMMs2S7bszwPxR2-fC8g4MeeIHxIqR0B9Aq5rO8b_8qzm')"
            }}
          ></div>
          <div className="flex flex-col gap-8 justify-center md:w-1/2">
            <div className="flex flex-col gap-2 text-left">
              <h1 className="text-[#101419] text-4xl font-black leading-tight tracking-[-0.033em] md:text-5xl">
                AI-powered property valuations
              </h1>
              <h2 className="text-[#101419] text-base font-normal leading-normal">
                Save time and money with our AI-driven property valuation
                tool. Get accurate estimates in seconds, allowing you to
                focus on your clients and close more deals.
              </h2>
            </div>
            <Link
              to="/sign-up"
              className="flex min-w-[84px] max-w-xs cursor-pointer items-center justify-center overflow-hidden rounded-full h-12 px-5 bg-[#d2e2f3] text-[#101419] text-base font-bold leading-normal tracking-[0.015em]"
            >
              <span className="truncate">Get Started</span>
            </Link>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-10 px-4 py-10">
        <div className="flex flex-col gap-4">
          <h1 className="text-[#101419] tracking-light text-4xl font-black leading-tight max-w-3xl">
            Key Features
          </h1>
          <p className="text-[#101419] text-base font-normal leading-normal max-w-3xl">
            Our software offers a range of features designed to streamline
            your workflow and provide accurate property valuations.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
          <div className="flex flex-col gap-3 pb-3">
            <div
              className="w-full bg-center bg-no-repeat aspect-video bg-cover rounded-xl"
              style={{
                backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCeMB-BDXLrIv8RRH9S86jNIVUVnomq48kMAjXqMWyqDlsQtyaIoOAJxRWRa2QRKijiPvRHAL2K3YmsMq-i_GQcik4Tr7SxpTx_x3K3C58k6bViWnKJ7X-jZMHhgYbHvF3f34WBRqR1dvVM0nXK3ABPAMxa7D5Sf28W-fE6Lw1nXw_BmX0idoX9qHshx4alvPBsAshf827opDSk1Qq4i3WX5EBMcU5J3gPegZ8mzkev9AX0rGYA8Wrurq63So60XR-5v6qoRKgtPzGf')"
              }}
            ></div>
            <div>
              <p className="text-[#101419] text-base font-medium leading-normal">
                Instant Valuation
              </p>
              <p className="text-[#58728d] text-sm font-normal leading-normal">
                Get property valuations in seconds with our AI-powered
                algorithm.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 pb-3">
            <div
              className="w-full bg-center bg-no-repeat aspect-video bg-cover rounded-xl"
              style={{
                backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuDqSdZI1mRhFaIxSKMV9g_m_WMYAFklnr_6u5mw3ZSOu__F-EoiSvX3lmRzul4Pox8U5uXuWep_E2hHb7VcYqUyGCd57T9w9vz5zs6hRvRXJ9F54tJlDDheqq9E02aWDrSyTLUeR2IzmoXqhPTw87RDc3Nzf60P8oWriWJJbi89ncPbogysT8koZ9FBURoGXoPnY-Jzo65kmni-nG6Te6I-9fBIRuVA3F-HbWIkhjDpo31451rBUTWXLwQ3smH_8M6klatf-76GywEf')"
              }}
            ></div>
            <div>
              <p className="text-[#101419] text-base font-medium leading-normal">
                Market Analysis
              </p>
              <p className="text-[#58728d] text-sm font-normal leading-normal">
                Access detailed market analysis and trends for any
                property.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 pb-3">
            <div
              className="w-full bg-center bg-no-repeat aspect-video bg-cover rounded-xl"
              style={{
                backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuBi9vL14Da7uqxIqvis_SmEQNV1_93wlTxyDv8T_s1yb92ruoqBvndy6Zm585lHAFPDd1DsjmGJO6Ed78w33QQof5KDNR9I3PlrmtmIVk-ABx6MkijXmUkSgjuWOcMQFOD61Uwb_CpSeUv2dRZeMxm1384J9_VWVGfvmq0AxOPx4-eJODPPhvznybOQB5i2GAU7mp_c-BgLc6ZfeWrLw9NtnvEtLdYfAdi8N_i4SqtB2aL569ECgAl8vgK_iYPi_Mhi-D4bWYtJt9ew')"
              }}
            ></div>
            <div>
              <p className="text-[#101419] text-base font-medium leading-normal">
                Comparable Sales
              </p>
              <p className="text-[#58728d] text-sm font-normal leading-normal">
                View comparable sales data to support your valuations.
              </p>
            </div>
          </div>
        </div>
      </div>
      <div className="flex flex-col justify-center items-center gap-6 px-4 py-20 text-center">
        <h1 className="text-[#101419] text-4xl font-black leading-tight max-w-3xl">
          Ready to revolutionize your property valuation process?
        </h1>
        <p className="text-[#101419] text-base font-normal leading-normal max-w-3xl">
          Sign up for a free trial and experience the power of AI in
          real estate.
        </p>
        <Link
          to="/sign-up"
          className="flex min-w-[84px] max-w-xs cursor-pointer items-center justify-center overflow-hidden rounded-full h-12 px-5 bg-[#d2e2f3] text-[#101419] text-base font-bold leading-normal tracking-[0.015em]"
        >
          <span className="truncate">Get started</span>
        </Link>
      </div>
    </main>

    <footer className="flex justify-center py-10">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex flex-wrap items-center justify-center gap-6">
          <a className="text-[#58728d] text-base font-normal leading-normal" href="#">Terms of Service</a>
          <a className="text-[#58728d] text-base font-normal leading-normal" href="#">Privacy Policy</a>
          <a className="text-[#58728d] text-base font-normal leading-normal" href="#">Contact Us</a>
        </div>
        <p className="text-[#58728d] text-sm font-normal leading-normal">
          © 2023 PropertyVal. All rights reserved.
        </p>
      </div>
    </footer>
  </div>
);

export default Landing; 