import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DashboardLayout } from "./components/DashboardLayout";
import { ChatHistoryProvider } from "./components/ChatHistoryContext";
import { SystemProvider } from "./contexts/SystemContext";
import { BackendApiProvider } from "./components/BackendApi";
import { AuthGuard } from "./components/AuthGuard";
import { Landing } from "./components/Landing";
import { BookDemo } from "./components/BookDemo";
import Login from "./components/Login";
import { SignUp } from "./components/SignUp";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <SystemProvider>
        <BackendApiProvider>
          <BrowserRouter>
            <Toaster />
            <Sonner />
            <Routes>
              {/* Public routes - no authentication required */}
              <Route path="/" element={<Landing />} />
              <Route path="/book-demo" element={<BookDemo />} />
              <Route path="/login" element={<Login />} />
              <Route path="/signup" element={<SignUp />} />
              
              {/* Protected routes - require authentication */}
              <Route path="/dashboard" element={
                <AuthGuard>
                  <ChatHistoryProvider>
                    <DashboardLayout />
                  </ChatHistoryProvider>
                </AuthGuard>
              } />
              
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </BackendApiProvider>
      </SystemProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
