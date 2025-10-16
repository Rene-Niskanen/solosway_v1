"use client";

import * as React from "react";
import { useToast } from "@/hooks/use-toast";
import { useSystem } from "@/contexts/SystemContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { MapPin, FileText, Activity, BarChart3, RefreshCw, ChevronRight } from "lucide-react";
import DocumentMapping from "./analytics/DocumentMapping";
import ActivityFeed from "./analytics/ActivityFeed";

interface AnalyticsProps {
  className?: string;
}

export default function Analytics({ className }: AnalyticsProps) {
  const { documents, activities, deleteDocument, getTotalStorage, getProcessingCount, addActivity } = useSystem();
  const [selectedDocument, setSelectedDocument] = React.useState<any>(null);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const { toast } = useToast();

  const handleDeleteDocument = (documentId: string) => {
    const document = documents.find(doc => doc.id === documentId);
    if (!document) return;
    
    deleteDocument(documentId);
    
    toast({
      title: "Document Deleted",
      description: `${document.name} has been removed from the system.`,
      duration: 3000,
      className: "border-red-200 bg-gradient-to-r from-red-50 to-rose-50"
    });
  };

  const handleRefreshData = () => {
    setIsRefreshing(true);
    
    // Simulate data refresh with more realistic timing
    setTimeout(() => {
      setIsRefreshing(false);
      addActivity({
        action: 'Analytics dashboard data refreshed successfully',
        documents: [],
        type: 'analysis',
        details: { refreshTime: new Date().toISOString() }
      });
      
      toast({
        title: "✨ Data Refreshed",
        description: "Analytics data has been updated with the latest information.",
        duration: 2000,
        className: "border-emerald-200 bg-gradient-to-r from-emerald-50 to-green-50"
      });
    }, 1200);
  };


  return (
    <div className={`relative w-full h-full bg-slate-50 ${className || ''}`}>
      {/* Modern Minimal Header */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-white/80 backdrop-blur-sm border-b border-slate-200/50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <MapPin className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-lg font-semibold text-slate-900">Property Analytics</h1>
          </div>
          
          <div className="flex items-center space-x-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefreshData}
              disabled={isRefreshing}
              className="text-slate-600 hover:text-slate-900"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content (map removed) */}
      <div className="absolute inset-0 pt-16 overflow-auto">
        <div className="mx-auto max-w-6xl p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white rounded-xl border border-slate-200/60 p-6 shadow-sm">
              <div className="text-3xl font-bold text-slate-900">{documents.length}</div>
              <div className="text-sm text-slate-500 mt-1">Total Documents</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200/60 p-6 shadow-sm">
              <div className="text-3xl font-bold text-blue-600">{getProcessingCount()}</div>
              <div className="text-sm text-slate-500 mt-1">Processing</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200/60 p-6 shadow-sm">
              <div className="text-lg font-semibold text-slate-700">{getTotalStorage()}</div>
              <div className="text-sm text-slate-500 mt-1">Total Storage</div>
            </div>
          </div>

          {/* Recent activity list */}
          <div className="mt-6 bg-white rounded-xl border border-slate-200/60 p-6 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900 mb-3">Recent Activity</h2>
            <ActivityFeed activities={activities} />
          </div>
        </div>
      </div>

      {/* Floating Stats Panel */}
      <div className="absolute top-20 left-4 z-30">
        <div className="bg-white/90 backdrop-blur-sm rounded-xl border border-slate-200/50 shadow-lg p-4 min-w-[280px]">
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-slate-900">{documents.length}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Properties</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{getProcessingCount()}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Processing</div>
            </div>
            <div className="text-center col-span-2">
              <div className="text-lg font-semibold text-slate-700">{getTotalStorage()}</div>
              <div className="text-xs text-slate-500 uppercase tracking-wide">Total Storage</div>
            </div>
          </div>
        </div>
      </div>

      {/* Activity Sheet */}
      <div className="absolute top-20 right-4 z-30">
        <Sheet>
          <SheetTrigger asChild>
            <Button 
              variant="outline" 
              size="sm"
              className="bg-white/90 backdrop-blur-sm border-slate-200/50 hover:bg-white"
            >
              <Activity className="w-4 h-4 mr-2" />
              Activity
              <Badge variant="secondary" className="ml-2 text-xs">
                {activities.length}
              </Badge>
              <ChevronRight className="w-3 h-3 ml-1" />
            </Button>
          </SheetTrigger>
          <SheetContent className="w-96">
            <SheetHeader>
              <SheetTitle className="flex items-center">
                <Activity className="w-4 h-4 mr-2" />
                Recent Activity
              </SheetTitle>
            </SheetHeader>
            <div className="mt-6">
              <ActivityFeed activities={activities} />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* File Management Sheet */}
      <div className="absolute bottom-4 right-4 z-30">
        <Sheet>
          <SheetTrigger asChild>
            <Button 
              className="bg-blue-500 hover:bg-blue-600 text-white shadow-lg"
              size="sm"
            >
              <FileText className="w-4 h-4 mr-2" />
              Files ({documents.length})
            </Button>
          </SheetTrigger>
          <SheetContent className="w-96">
            <SheetHeader>
              <SheetTitle className="flex items-center">
                <FileText className="w-4 h-4 mr-2" />
                Property Documents
              </SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-3 max-h-[80vh] overflow-y-auto">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                  onClick={() => setSelectedDocument(doc)}
                >
                  <div className="flex items-center space-x-3 flex-1 min-w-0">
                    <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center flex-shrink-0">
                      <FileText className="w-4 h-4 text-white" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900 truncate text-sm">{doc.name}</p>
                      <p className="text-xs text-slate-500 truncate">
                        {doc.propertyAddress || 'No address'}
                      </p>
                    </div>
                  </div>
                  <Badge 
                    variant={doc.status === 'processed' ? 'default' : 'secondary'}
                    className="text-xs"
                  >
                    {doc.status}
                  </Badge>
                </div>
              ))}
              {documents.length === 0 && (
                <div className="text-center py-8 text-slate-500">
                  <FileText className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                  <p className="text-sm">No documents uploaded yet</p>
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}