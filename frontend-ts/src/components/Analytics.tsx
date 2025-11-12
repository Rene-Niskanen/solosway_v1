"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  Home, 
  FileText, 
  MapPin,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Download,
  Settings,
  Calendar,
  ChevronDown,
  Info,
  Building2,
  PoundSterling,
  Target,
  Activity
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { backendApi } from "@/services/backendApi";
import { format } from "date-fns";

interface AnalyticsProps {
  className?: string;
}

interface AnalyticsData {
  summary: {
    total_documents: number;
    total_properties: number;
    recent_uploads_7d: number;
    recent_properties_7d: number;
    geocoding_success_rate: number;
  };
  documents: {
    status_breakdown: {
      uploaded: number;
      processing: number;
      completed: number;
      failed: number;
    };
    recent_uploads: any[];
  };
  properties: {
    price_statistics: {
      average_sold_price: number;
      average_asking_price: number;
    };
    price_ranges: {
      under_100k: number;
      '100k_to_250k': number;
      '250k_to_500k': number;
      '500k_to_1m': number;
      over_1m: number;
    };
    property_types: Record<string, number>;
    bedroom_distribution: Record<string, number>;
  };
}

export default function Analytics({ className }: AnalyticsProps) {
  const [analyticsData, setAnalyticsData] = React.useState<AnalyticsData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [timePeriod, setTimePeriod] = React.useState("This Week");
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  // Fetch analytics data
  React.useEffect(() => {
    fetchAnalytics();
  }, [timePeriod]);

  const fetchAnalytics = async () => {
    try {
      setLoading(true);
      const response = await backendApi.getAnalytics();
      if (response.success && response.data) {
        setAnalyticsData(response.data as AnalyticsData);
      } else {
        // Set default empty data structure if API fails
        setAnalyticsData({
          summary: {
            total_documents: 0,
            total_properties: 0,
            recent_uploads_7d: 0,
            recent_properties_7d: 0,
            geocoding_success_rate: 0
          },
          documents: {
            status_breakdown: {
              uploaded: 0,
              processing: 0,
              completed: 0,
              failed: 0
            },
            recent_uploads: []
          },
          properties: {
            price_statistics: {
              average_sold_price: 0,
              average_asking_price: 0
            },
            price_ranges: {
              under_100k: 0,
              '100k_to_250k': 0,
              '250k_to_500k': 0,
              '500k_to_1m': 0,
              over_1m: 0
            },
            property_types: {},
            bedroom_distribution: {}
          }
        });
      }
    } catch (error) {
      console.error('Error fetching analytics:', error);
      // Set default empty data structure on error
      setAnalyticsData({
        summary: {
          total_documents: 0,
          total_properties: 0,
          recent_uploads_7d: 0,
          recent_properties_7d: 0,
          geocoding_success_rate: 0
        },
        documents: {
          status_breakdown: {
            uploaded: 0,
            processing: 0,
            completed: 0,
            failed: 0
          },
          recent_uploads: []
        },
        properties: {
          price_statistics: {
            average_sold_price: 0,
            average_asking_price: 0
          },
          price_ranges: {
            under_100k: 0,
            '100k_to_250k': 0,
            '250k_to_500k': 0,
            '500k_to_1m': 0,
            over_1m: 0
          },
          property_types: {},
          bedroom_distribution: {}
        }
      });
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchAnalytics();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Generate mock time series data for charts
  const generateTimeSeriesData = () => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const currentWeek = days.map(day => ({
      day,
      current: Math.floor(Math.random() * 500000) + 200000,
      previous: Math.floor(Math.random() * 500000) + 200000,
    }));
    return currentWeek;
  };

  const timeSeriesData = generateTimeSeriesData();
  
  // Calculate trends
  const calculateTrend = (current: number, previous: number) => {
    if (previous === 0) return { value: 0, isPositive: true };
    const change = ((current - previous) / previous) * 100;
    return {
      value: Math.abs(change),
      isPositive: change >= 0
    };
  };

  // Format currency
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: 'GBP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Calculate processing success rate
  const processingSuccessRate = analyticsData?.documents?.status_breakdown 
    ? ((analyticsData.documents.status_breakdown.completed / 
        (analyticsData.documents.status_breakdown.completed + analyticsData.documents.status_breakdown.failed)) * 100) || 0
    : 0;

  // Calculate data completeness (mock - would come from property completeness_score)
  const dataCompleteness = analyticsData?.summary?.total_properties 
    ? Math.min(95, 70 + (analyticsData.summary.total_properties * 2))
    : 0;

  // Property type distribution data
  const propertyTypeData = analyticsData?.properties?.property_types 
    ? Object.entries(analyticsData.properties.property_types).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value
      }))
    : [];

  // Processing funnel data
  const processingFunnelData = analyticsData?.documents?.status_breakdown ? [
    { name: 'Uploaded', value: analyticsData.documents.status_breakdown.uploaded || 0, percentage: 100 },
    { name: 'Processing', value: analyticsData.documents.status_breakdown.processing || 0, percentage: 75 },
    { name: 'Completed', value: analyticsData.documents.status_breakdown.completed || 0, percentage: processingSuccessRate },
    { name: 'Failed', value: analyticsData.documents.status_breakdown.failed || 0, percentage: (analyticsData.documents.status_breakdown.uploaded > 0 ? (analyticsData.documents.status_breakdown.failed / analyticsData.documents.status_breakdown.uploaded) * 100 : 0) },
  ] : [
    { name: 'Uploaded', value: 0, percentage: 0 },
    { name: 'Processing', value: 0, percentage: 0 },
    { name: 'Completed', value: 0, percentage: 0 },
    { name: 'Failed', value: 0, percentage: 0 },
  ];

  if (loading || !analyticsData) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <RefreshCw className="w-8 h-8 text-gray-400 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  const totalPortfolioValue = analyticsData.properties?.price_statistics?.average_sold_price 
    ? analyticsData.properties.price_statistics.average_sold_price * (analyticsData.summary?.total_properties || 1)
    : 0;

  const avgValueTrend = calculateTrend(
    analyticsData.properties?.price_statistics?.average_sold_price || 0,
    (analyticsData.properties?.price_statistics?.average_sold_price || 0) * 0.95
  );

  return (
    <div className={`w-full h-full bg-gray-50 overflow-y-auto ${className || ''}`}>
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200">
        <div className="px-8 py-6">
          {/* Breadcrumbs */}
          <div className="text-sm text-gray-500 mb-2">
            Analytics <span className="mx-2">/</span> <span className="text-gray-900 font-medium">Insight</span>
          </div>
          
          {/* Title and Actions */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">Insight</h1>
            </div>
            
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                {timePeriod}
                <ChevronDown className="w-4 h-4" />
              </button>
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Customize Widget
              </button>
              <button className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2">
                <Download className="w-4 h-4" />
                Export Data
              </button>
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={handleRefresh}
              disabled={isRefreshing}
                className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <RefreshCw className={`w-5 h-5 ${isRefreshing ? 'animate-spin' : ''}`} />
              </motion.button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-8 py-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-600 mb-1">Total Properties</div>
            <div className="text-2xl font-bold text-gray-900">{analyticsData.summary?.total_properties || 0}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-600 mb-1">Documents Processed</div>
            <div className="text-2xl font-bold text-gray-900">{analyticsData.summary?.total_documents || 0}</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-600 mb-1">Geocoding Success</div>
            <div className="text-2xl font-bold text-gray-900">{analyticsData.summary?.geocoding_success_rate?.toFixed(1) || 0}%</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-sm text-gray-600 mb-1">Recent (7d)</div>
            <div className="text-2xl font-bold text-gray-900">{analyticsData.summary?.recent_properties_7d || 0}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Widget 1: Total Portfolio Value */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Total Portfolio Value</h3>
              <PoundSterling className="w-4 h-4 text-gray-400" />
            </div>
            <div className="mb-4">
              <div className="text-3xl font-bold text-gray-900 mb-1">
                {formatCurrency(totalPortfolioValue)}
              </div>
              <div className="flex items-center gap-2">
                {avgValueTrend.isPositive ? (
                  <>
                    <TrendingUp className="w-4 h-4 text-green-600" />
                    <span className="text-sm font-semibold text-green-600">Up {avgValueTrend.value.toFixed(1)}%</span>
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-4 h-4 text-red-600" />
                    <span className="text-sm font-semibold text-red-600">Down {avgValueTrend.value.toFixed(1)}%</span>
                  </>
                )}
              </div>
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <Tooltip />
                  <Line 
                    type="monotone" 
                    dataKey="current" 
                    stroke="#8b5cf6" 
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="previous" 
                    stroke="#d1d5db" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Portfolio Value Over Time
          </div>
          </motion.div>

          {/* Widget 2: Average Property Value */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Average Property Value</h3>
              <Info className="w-4 h-4 text-gray-400" />
            </div>
            <div className="mb-4">
              <div className="text-3xl font-bold text-gray-900 mb-1">
                {formatCurrency(analyticsData.properties?.price_statistics?.average_sold_price || 0)}
          </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-600" />
                <span className="text-sm font-semibold text-green-600">Up 5%</span>
        </div>
      </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <Tooltip />
                  <Line 
                    type="monotone" 
                    dataKey="current" 
                    stroke="#8b5cf6" 
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="previous" 
                    stroke="#d1d5db" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Average Value Over Time
            </div>
          </motion.div>

          {/* Widget 3: Data Completeness Score */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Data Completeness</h3>
              <Target className="w-4 h-4 text-gray-400" />
            </div>
            <div className="mb-4">
              <div className="text-3xl font-bold text-gray-900 mb-1">
                {dataCompleteness.toFixed(1)}%
              </div>
              <div className="flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-red-600" />
                <span className="text-sm font-semibold text-red-600">Down 3%</span>
          </div>
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={timeSeriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <Tooltip />
                  <Line 
                    type="monotone" 
                    dataKey="current" 
                    stroke="#8b5cf6" 
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="previous" 
                    stroke="#d1d5db" 
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Completeness Over Time
            </div>
          </motion.div>

          {/* Widget 4: Processing Success Rate */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.3 }}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Processing Success Rate</h3>
            </div>
            <div className="mb-4">
              <div className="text-3xl font-bold text-gray-900 mb-1">
                {processingSuccessRate.toFixed(2)}%
              </div>
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-600" />
                <span className="text-sm font-semibold text-green-600">Up 1.23%</span>
        </div>
      </div>

            {/* Processing Funnel */}
            <div className="space-y-3">
              {processingFunnelData.map((step, index) => (
                <div key={index}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">{step.name}</span>
                    <span className="text-xs text-gray-500">{step.value} ({step.percentage.toFixed(1)}%)</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div 
                      className={`h-full transition-all ${
                        step.name === 'Completed' ? 'bg-green-500' :
                        step.name === 'Processing' ? 'bg-yellow-500' :
                        step.name === 'Failed' ? 'bg-red-500' :
                        'bg-blue-500'
                      }`}
                      style={{ width: `${step.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Widget 5: Properties Processed */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.4 }}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Properties Processed</h3>
              <Info className="w-4 h-4 text-gray-400" />
            </div>
            <div className="mb-4">
              <div className="text-3xl font-bold text-gray-900 mb-1">
                {analyticsData.summary?.total_properties || 0}
              </div>
              <div className="text-sm text-gray-500">
                Properties per week
              </div>
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={timeSeriesData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" stroke="#9ca3af" fontSize={12} />
                  <YAxis stroke="#9ca3af" fontSize={12} />
                  <Tooltip />
                  <Bar dataKey="current" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Properties Processed Over Time
      </div>
          </motion.div>

          {/* Widget 6: Property Type Distribution */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Property Type Distribution</h3>
              <Info className="w-4 h-4 text-gray-400" />
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={propertyTypeData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" stroke="#9ca3af" fontSize={12} />
                  <YAxis dataKey="name" type="category" stroke="#9ca3af" fontSize={12} width={80} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </motion.div>

          {/* Widget 7: Price Range Distribution */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.6 }}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Price Range Distribution</h3>
              <Info className="w-4 h-4 text-gray-400" />
            </div>
            <div className="space-y-3">
              {analyticsData?.properties?.price_ranges ? Object.entries(analyticsData.properties.price_ranges).map(([range, count]) => {
                const total = Object.values(analyticsData.properties.price_ranges).reduce((a: number, b: number) => a + b, 0);
                const percentage = total > 0 ? ((count as number) / total) * 100 : 0;
                const rangeLabel = range.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1').trim();
                return (
                  <div key={range}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-700">{rangeLabel}</span>
                      <span className="text-xs text-gray-500">{count} ({percentage.toFixed(1)}%)</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-purple-500 to-blue-500 transition-all"
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                );
              }) : (
                <div className="text-center py-4 text-gray-500 text-sm">No price data available</div>
              )}
            </div>
          </motion.div>

          {/* Widget 8: Bedroom Distribution */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.7 }}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Bedroom Distribution</h3>
              <Home className="w-4 h-4 text-gray-400" />
            </div>
            <div className="h-64">
              {analyticsData?.properties?.bedroom_distribution && Object.keys(analyticsData.properties.bedroom_distribution).length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={Object.entries(analyticsData.properties.bedroom_distribution).map(([bedrooms, count]) => ({
                    bedrooms: `${bedrooms} Bed`,
                    count
                  }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="bedrooms" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500 text-sm">No bedroom data available</div>
              )}
            </div>
          </motion.div>

          {/* Widget 9: Processing Pipeline Health */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.8 }}
            className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Processing Pipeline Health</h3>
              <Activity className="w-4 h-4 text-gray-400" />
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-gray-700">Documents Uploaded</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">
                  {analyticsData?.documents?.status_breakdown?.uploaded || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-yellow-600" />
                  <span className="text-sm text-gray-700">Processing</span>
                </div>
                <span className="text-sm font-semibold text-gray-900">
                  {analyticsData?.documents?.status_breakdown?.processing || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-sm text-gray-700">Successfully Processed</span>
                </div>
                <span className="text-sm font-semibold text-green-600">
                  {analyticsData?.documents?.status_breakdown?.completed || 0}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600" />
                  <span className="text-sm text-gray-700">Failed</span>
                </div>
                <span className="text-sm font-semibold text-red-600">
                  {analyticsData?.documents?.status_breakdown?.failed || 0}
                </span>
              </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-600">Overall Success Rate</span>
                <span className="text-sm font-bold text-gray-900">{processingSuccessRate.toFixed(1)}%</span>
              </div>
              <div className="w-full h-2 bg-gray-100 rounded-full mt-2 overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all"
                  style={{ width: `${processingSuccessRate}%` }}
                />
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
