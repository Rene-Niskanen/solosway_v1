import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import BaseLayout from './BaseLayout';
import Overview from './tabs/Overview';
import MarketAnalysis from './tabs/MarketAnalysis';
import Comparables from './tabs/Comparables';
import ComparableAnalysis from './tabs/ComparableAnalysis';
import MyReports from './tabs/MyReports';
import AgentChat from './AgentChat';

// Configure axios to include credentials
axios.defaults.withCredentials = true;

const TABS = [
  { id: 'overview', label: 'Overview', component: Overview },
  { id: 'market_analysis', label: 'Market Analysis', component: MarketAnalysis },
  { id: 'comparables', label: 'Comparables', component: Comparables },
  { id: 'comparable_analysis', label: 'Comparable Analysis', component: ComparableAnalysis },
  { id: 'my_reports', label: 'My Reports', component: MyReports },
];

const CurrentAppraisal = ({ user }) => {
  const { id } = useParams();
  const [activeTab, setActiveTab] = useState('overview');
  const [appraisal, setAppraisal] = useState(null);
  const [comparableProperties, setComparableProperties] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedComparables, setSelectedComparables] = useState([]);

  useEffect(() => {
    fetchAppraisalData();
    // eslint-disable-next-line
  }, [id]);

  const fetchAppraisalData = async () => {
    try {
      setLoading(true);
      // Fetch appraisal data from Flask backend
      const response = await axios.get(`/api/appraisal/${id}`);
      setAppraisal(response.data.appraisal);
      setComparableProperties(response.data.comparable_properties || []);
      setChatMessages(response.data.chat_messages || []);
    } catch (err) {
      if (err.response?.status === 403) {
        setError('Please log in to view this appraisal');
      } else if (err.response?.status === 404) {
        setError('Appraisal not found');
      } else {
        setError('Failed to load appraisal data');
      }
      console.error('Error fetching appraisal:', err);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (messageContent) => {
    try {
      const response = await axios.post(`/api/appraisal/${id}/chat`, {
        message: messageContent
      });
      
      // Add user message
      const userMessage = {
        id: Date.now(),
        content: messageContent,
        is_user: true,
        timestamp: new Date()
      };
      
      // Add AI response
      const aiMessage = {
        id: Date.now() + 1,
        content: response.data.ai_response || "I've received your message and will analyze the property details. Please give me a moment to process this information.",
        is_user: false,
        timestamp: new Date()
      };
      
      setChatMessages(prev => [...prev, userMessage, aiMessage]);
    } catch (err) {
      console.error('Error sending message:', err);
    }
  };

  const handleSelectComparable = (id) => {
    setSelectedComparables((prev) =>
      prev.includes(id) ? prev.filter((compId) => compId !== id) : [...prev, id]
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl">Loading appraisal...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl text-red-600">{error}</div>
      </div>
    );
  }

  if (!appraisal) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl">Appraisal not found</div>
      </div>
    );
  }

  const ActiveTabComponent = TABS.find(tab => tab.id === activeTab)?.component || Overview;

  return (
    <BaseLayout user={user}>
      <div className="flex w-full h-full overflow-hidden">
        {/* Left: Tabs and Content */}
        <div className="flex-1 min-w-0 h-full overflow-y-auto flex flex-col">
          {/* Tab Navigation */}
          <div className="flex border-b bg-white sticky top-0 z-10">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={`px-6 py-3 text-sm font-semibold focus:outline-none transition-colors border-b-2 ${activeTab === tab.id ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-transparent text-gray-500 hover:text-blue-700'}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {/* Tab Content */}
          <div className="flex-1 min-h-0 bg-white">
            <ActiveTabComponent />
          </div>
        </div>
        {/* Right: AgentChat */}
        <div className="w-96 min-w-[320px] max-w-[480px] h-full flex flex-col overflow-y-auto">
          <AgentChat
            chatMessages={chatMessages}
            onSendMessage={sendMessage}
          />
        </div>
      </div>
    </BaseLayout>
  );
};

export default CurrentAppraisal; 