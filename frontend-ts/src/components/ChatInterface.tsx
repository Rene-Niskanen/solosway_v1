"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Copy, ThumbsUp, ThumbsDown, Check, ArrowLeft, X, ChevronRight } from "lucide-react";
import { ImageUploadButton } from './ImageUploadButton';
import PropertyResultsDisplay from './PropertyResultsDisplay';
import { SquareMap } from './SquareMap';
// Import the same mock data that the map view uses
// This ensures both interfaces show the same results
const mockPropertyData = [
  {
    id: 1,
    address: "24 Runthorpe Road, Clifton, Bristol",
    postcode: "BS8 2AB",
    property_type: "Semi-Detached",
    bedrooms: 3,
    bathrooms: 2,
    price: 450000,
    square_feet: 1200,
    days_on_market: 45,
    latitude: 51.4600,
    longitude: -2.6100,
    summary: "Beautiful 3-bedroom semi-detached house in Clifton",
    features: "Garden, Parking, Modern Kitchen",
    condition: 8,
    similarity: 95,
    image: "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 2,
    address: "15 Clifton Park, Clifton, Bristol",
    postcode: "BS8 3CD",
    property_type: "Detached",
    bedrooms: 3,
    bathrooms: 2,
    price: 550000,
    square_feet: 1400,
    days_on_market: 23,
    latitude: 51.4610,
    longitude: -2.6120,
    summary: "Stunning 3-bedroom detached house with garden",
    features: "Large Garden, Garage, En-suite",
    condition: 9,
    similarity: 92,
    image: "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 3,
    address: "8 Clifton Road, Clifton, Bristol",
    postcode: "BS8 4EF",
    property_type: "Terraced",
    bedrooms: 3,
    bathrooms: 1,
    price: 380000,
    square_feet: 1100,
    days_on_market: 67,
    latitude: 51.4625,
    longitude: -2.6129,
    summary: "Charming 3-bedroom terraced house",
    features: "Period Features, Close to Station",
    condition: 7,
    similarity: 88,
    image: "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 4,
    address: "42 Clifton Hill, Clifton, Bristol",
    postcode: "BS8 4JX",
    property_type: "Semi-Detached",
    bedrooms: 2,
    bathrooms: 1,
    price: 320000,
    square_feet: 850,
    days_on_market: 34,
    latitude: 51.4685,
    longitude: -2.6149,
    summary: "Modern 2-bedroom semi-detached house",
    features: "Off-street Parking, Garden, Modern Bathroom",
    condition: 8,
    similarity: 90,
    image: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=400&h=300&fit=crop",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 16,
    address: "12 Whiteladies Road, Clifton, Bristol",
    postcode: "BS8 2BS",
    property_type: "Apartment",
    bedrooms: 2,
    bathrooms: 2,
    price: 350000,
    square_feet: 800,
    days_on_market: 23,
    latitude: 51.4660,
    longitude: -2.6120,
    summary: "Modern 2-bedroom apartment with balcony",
    features: "Balcony, Parking, Modern Kitchen, En-suite",
    condition: 9,
    similarity: 88,
    image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 18,
    address: "25 Clifton Hill, Clifton, Bristol",
    postcode: "BS8 1JX",
    property_type: "Semi-Detached",
    bedrooms: 2,
    bathrooms: 1,
    price: 380000,
    square_feet: 900,
    days_on_market: 45,
    latitude: 51.4660,
    longitude: -2.6110,
    summary: "Charming 2-bedroom semi-detached house",
    features: "Garden, Parking, Period Features",
    condition: 7,
    similarity: 85,
    image: "https://images.unsplash.com/photo-1600566753190-17f63ba4f6fd?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 22,
    address: "42 Clifton Street, Clifton, Bristol",
    postcode: "BS8 4EF",
    property_type: "Terraced",
    bedrooms: 2,
    bathrooms: 1,
    price: 320000,
    square_feet: 750,
    days_on_market: 67,
    latitude: 51.4630,
    longitude: -2.6100,
    summary: "Cozy 2-bedroom terraced house",
    features: "Period Features, Garden",
    condition: 6,
    similarity: 82,
    image: "https://images.unsplash.com/photo-1600607687920-4e2a09cf159d?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  },
  {
    id: 27,
    address: "22 Clifton Road, Clifton, Bristol",
    postcode: "BS8 4EF",
    property_type: "Semi-Detached",
    bedrooms: 2,
    bathrooms: 1,
    price: 360000,
    square_feet: 850,
    days_on_market: 38,
    latitude: 51.4625,
    longitude: -2.6119,
    summary: "Charming 2-bedroom semi-detached house",
    features: "Garden, Parking, Period Features",
    condition: 7,
    similarity: 84,
    image: "https://images.unsplash.com/photo-1600566753190-17f63ba4f6fd?w=400&h=300&fit=crop&crop=center&auto=format&q=80",
    agent: {
      name: "Jerome Bell",
      company: "harperjamesproperty36"
    }
  }
];
import { analyzeQueryWithLLM, LLMAnalysisResult } from '../llm/llmService';

// Import property images
import property1 from "@/assets/property-1.jpg";
import property2 from "@/assets/property-2.jpg";
import property3 from "@/assets/property-3.jpg";
export interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}
export interface ChatInterfaceProps {
  initialQuery?: string;
  onBack?: () => void;
  onMessagesUpdate?: (messages: Message[]) => void;
  className?: string;
  loadedMessages?: Message[];
  isFromHistory?: boolean;
}

// Smooth transition easing - using framer motion easing arrays  
const smoothEasing = [0.4, 0, 0.2, 1] as const;
const snapEasing = [0.6, 0, 0.4, 1] as const;
const preciseEasing = [0.25, 0.1, 0.25, 1] as const;
export default function ChatInterface({
  initialQuery = "",
  onBack,
  onMessagesUpdate,
  className,
  loadedMessages,
  isFromHistory = false
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [likedMessages, setLikedMessages] = useState<Set<string>>(new Set());
  const [dislikedMessages, setDislikedMessages] = useState<Set<string>>(new Set());
  const [propertyQueries, setPropertyQueries] = useState<Set<string>>(new Set()); // Track which messages are property responses
  const [isInputActivated, setIsInputActivated] = useState(false);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showInlineMap, setShowInlineMap] = useState(false);
  const [inlineMapMessageId, setInlineMapMessageId] = useState<string | null>(null);
  const [searchContext, setSearchContext] = useState<{
    location?: string;
    bedrooms?: number;
    bathrooms?: number;
    priceRange?: { min?: number; max?: number };
  }>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);

  // Sleek and smooth scroll function that ensures the full response is visible
  const scrollToShowResponse = (isPropertyResponse = false) => {
    if (!messagesEndRef.current || !messagesContainerRef.current) return;
    
    const scrollContainer = messagesContainerRef.current;
    
    // Ultra-smooth scroll with requestAnimationFrame for buttery smoothness
    const performUltraSmoothScroll = () => {
      if (!messagesEndRef.current || !scrollContainer) return;
      
      // Calculate the optimal scroll position
      const containerHeight = scrollContainer.clientHeight;
      const containerScrollHeight = scrollContainer.scrollHeight;
      const currentScrollTop = scrollContainer.scrollTop;
      
      // Calculate how much more we can scroll
      const maxScrollTop = containerScrollHeight - containerHeight;
      const chatBarHeight = 150; // Increased space for chat input bar
      const padding = isPropertyResponse ? 300 : 200; // Much larger padding to show full card
      const totalOffset = chatBarHeight + padding;
      
      // Calculate target position - be more aggressive for property responses
      let targetScrollTop;
      if (isPropertyResponse) {
        // For property responses, scroll to near the bottom to show full card
        targetScrollTop = Math.min(maxScrollTop, maxScrollTop - 50);
      } else {
        // For regular responses, use the calculated offset
        targetScrollTop = Math.min(maxScrollTop, currentScrollTop + totalOffset);
      }
      
      // Use requestAnimationFrame for ultra-smooth scrolling
      const startScrollTop = currentScrollTop;
      const distance = targetScrollTop - startScrollTop;
      const duration = 150; // 150ms for ultra-fast, immediate scroll
      let startTime: number | null = null;
      
      // Ultra-smooth easing function for buttery smooth scrolling
      const easeOutQuart = (t: number): number => {
        return 1 - Math.pow(1 - t, 4);
      };
      
      const animateScroll = (currentTime: number) => {
        if (startTime === null) startTime = currentTime;
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easedProgress = easeOutQuart(progress);
        
        const currentPosition = startScrollTop + (distance * easedProgress);
        scrollContainer.scrollTop = currentPosition;
        
        if (progress < 1) {
          requestAnimationFrame(animateScroll);
        }
      };
      
      requestAnimationFrame(animateScroll);
      
      // Also ensure the messages end is visible with smooth behavior
      messagesEndRef.current.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'end',
        inline: 'nearest'
      });
      
      // For property responses, also try scrolling to the very bottom
      if (isPropertyResponse) {
        setTimeout(() => {
          scrollContainer.scrollTo({
            top: scrollContainer.scrollHeight,
            behavior: 'smooth'
          });
        }, 25); // Reduced from 50ms to 25ms for faster response
      }
    };
    
    // Immediate ultra-smooth scroll
    performUltraSmoothScroll();
  };


  // Function to check if a query is property-related
  const isPropertyRelatedQuery = (query: string): boolean => {
    const lowerQuery = query.toLowerCase();
    const propertyKeywords = [
      'property', 'properties', 'comp', 'comps', 'comparable', 'comparables', 
      'house', 'houses', 'home', 'homes', 'real estate', 'listing', 'listings', 
      'bed', 'bedroom', 'bedrooms', 'bath', 'bathroom', 'bathrooms',
      'city centre', 'city center', 'centre', 'center', 'central', 'downtown',
      'clifton', 'bristol', 'filton', 'redland', 'montpelier',
      'show me', 'find me', 'get me', 'give me'
    ];
    
    // Check for bedroom patterns (e.g., "2 bed", "3 bedroom")
    const bedroomPattern = /(\d+)\s*(?:bed|bedroom|bedrooms)/;
    if (bedroomPattern.test(lowerQuery)) return true;
    
    // Check for location patterns (e.g., "in clifton", "at bristol")
    const locationPatterns = ['in ', 'at ', 'near ', 'around '];
    if (locationPatterns.some(pattern => lowerQuery.includes(pattern))) return true;
    
    return propertyKeywords.some(keyword => lowerQuery.includes(keyword));
  };

  // Load messages when loadedMessages prop changes
  React.useEffect(() => {
    console.log('ChatInterface - loadedMessages changed:', loadedMessages);
    if (loadedMessages && loadedMessages.length > 0) {
      console.log('Loading messages from history:', loadedMessages);
      // Set messages immediately without any loading state
      setMessages(loadedMessages);
      setIsInitialized(true);
      
      // Update property queries for loaded messages to preserve UI state
      const propertyMessageIds = new Set<string>();
      loadedMessages.forEach((message, index) => {
        if (message.role === 'assistant' && index > 0) {
          const previousMessage = loadedMessages[index - 1];
          if (previousMessage && isPropertyRelatedQuery(previousMessage.content)) {
            propertyMessageIds.add(message.id);
          }
        }
      });
      setPropertyQueries(propertyMessageIds);
      
    } else if (loadedMessages && loadedMessages.length === 0) {
      console.log('No messages to load, starting fresh chat');
      setMessages([]);
      setIsInitialized(true);
    }
  }, [loadedMessages]);

  // LLM functions are now imported from the dedicated service

  // Function to extract context from previous messages
  const extractContextFromMessages = (messages: Message[]): {
    location?: string;
    bedrooms?: number;
    bathrooms?: number;
    priceRange?: { min?: number; max?: number };
  } => {
    const context: any = {};
    
    // Look through recent messages for context clues
    const recentMessages = messages.slice(-5); // Check last 5 messages
    
    for (const message of recentMessages) {
      const content = message.content.toLowerCase();
      
      // Extract location context
      if (content.includes('city centre') || content.includes('city center')) {
        context.location = 'city centre';
      } else if (content.includes('clifton')) {
        context.location = 'clifton';
      } else if (content.includes('bristol')) {
        context.location = 'bristol';
      } else if (content.includes('filton')) {
        context.location = 'filton';
      } else if (content.includes('redland')) {
        context.location = 'redland';
      } else if (content.includes('montpelier')) {
        context.location = 'montpelier';
      }
      
      // Extract bedroom context
      const bedroomMatch = content.match(/(\d+)\s*(?:bed|bedroom|bedrooms)/);
      if (bedroomMatch) {
        context.bedrooms = parseInt(bedroomMatch[1]);
      }
      
      // Extract bathroom context
      const bathroomMatch = content.match(/(\d+)\s*(?:bath|bathroom|bathrooms)/);
      if (bathroomMatch) {
        context.bathrooms = parseInt(bathroomMatch[1]);
      }
      
      // Extract price context
      const priceMatch = content.match(/under\s*£?(\d+)(?:k|000)?/i);
      if (priceMatch) {
        context.priceRange = { max: parseInt(priceMatch[1]) * (priceMatch[1].length <= 3 ? 1000 : 1) };
      }
    }
    
    return context;
  };

  // Enhanced search function that matches the map view logic exactly
  const searchProperties = (query: string, context?: any) => {
    console.log('=== SEARCH FUNCTION CALLED ===');
    console.log('Query:', query);
    console.log('Context:', context);
    
    const lowerQuery = query.toLowerCase();
    let filteredProperties = [...mockPropertyData];
    
    // Extract bedroom count
    const bedroomMatch = lowerQuery.match(/(\d+)\s*(?:bed|bedroom|bedrooms)/);
    if (bedroomMatch) {
      const bedroomCount = parseInt(bedroomMatch[1]);
      console.log('Filtering by bedrooms:', bedroomCount);
      filteredProperties = filteredProperties.filter(p => p.bedrooms === bedroomCount);
    }
    
    // Enhanced location matching (same as map view)
    const locationKeywords = {
      'clifton': ['clifton', 'clifton village', 'clifton down', 'clifton hill', 'clifton park'],
      'redland': ['redland', 'redland road', 'redland park'],
      'cotham': ['cotham', 'cotham hill', 'cotham road'],
      'bishopston': ['bishopston', 'bishopston road'],
      'filton': ['filton', 'filton avenue', 'filton road', 'filton high street'],
      'henleaze': ['henleaze', 'henleaze road'],
      'stoke bishop': ['stoke bishop', 'stoke bishop road'],
      'westbury park': ['westbury park', 'westbury hill'],
      'horfield': ['horfield', 'horfield road'],
      'ashley down': ['ashley down', 'ashley down road'],
      'hotwells': ['hotwells', 'hotwells road'],
      'easton': ['easton', 'easton road'],
      'bedminster': ['bedminster', 'bedminster down'],
      'montpelier': ['montpelier', 'montpelier hill'],
      'city centre': ['city centre', 'city center', 'centre', 'center', 'broadmead', 'redcliffe', 'temple meads']
    };
    
    // Check for location match
    let queryLocation = null;
    let locationMatch = null;
    
    for (const [location, keywords] of Object.entries(locationKeywords)) {
      if (keywords.some(keyword => lowerQuery.includes(keyword))) {
        queryLocation = location;
        locationMatch = keywords.find(keyword => lowerQuery.includes(keyword));
        break;
      }
    }
    
    console.log('Detected location:', queryLocation);
    console.log('Location match:', locationMatch);
    
    // Filter by location
    if (queryLocation) {
      if (queryLocation === 'city centre') {
        console.log('Filtering by location: City Centre (Clifton/Bristol)');
        filteredProperties = filteredProperties.filter(p => 
          p.address.toLowerCase().includes('clifton') || 
          p.address.toLowerCase().includes('bristol')
        );
      } else {
        console.log(`Filtering by location: ${queryLocation}`);
        filteredProperties = filteredProperties.filter(p => 
          p.address.toLowerCase().includes(queryLocation)
        );
      }
    }
    
    console.log('Final filtered properties count:', filteredProperties.length);
    console.log('Sample results:', filteredProperties.slice(0, 3).map(p => ({ 
      id: p.id, 
      address: p.address, 
      bedrooms: p.bedrooms 
    })));
    
    // Debug: Log all properties that match the criteria
    console.log('=== ALL MATCHING PROPERTIES ===');
    filteredProperties.forEach(p => {
      console.log(`ID: ${p.id}, Address: ${p.address}, Bedrooms: ${p.bedrooms}`);
    });
    
    return filteredProperties;
  };

  // State to store current property results
  const [currentPropertyResults, setCurrentPropertyResults] = useState<any[]>([]);
  
  // Scroll when property results are displayed
  useEffect(() => {
    if (currentPropertyResults.length > 0) {
      // Immediate scroll as soon as property results appear
      scrollToShowResponse(true);
      
      // Additional immediate scroll after component renders
      requestAnimationFrame(() => {
        scrollToShowResponse(true);
      });
      
      // Extra immediate scroll for ultra-responsiveness
      setTimeout(() => scrollToShowResponse(true), 10);
    }
  }, [currentPropertyResults]);
  
  useEffect(() => {
    // When messages change, scroll to show the response immediately
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      const isPropertyResponse = lastMessage && lastMessage.content.includes('Property Results');
      
      // Immediate scroll as soon as message appears
      scrollToShowResponse(isPropertyResponse);
      
      // Additional immediate scroll for ultra-responsiveness
      setTimeout(() => scrollToShowResponse(isPropertyResponse), 5);
    }
  }, [messages]);
  
  useEffect(() => {
    // Scroll for typing indicator
    if (isTyping) {
      scrollToShowResponse(false);
    }
  }, [isTyping]);
  // Auto-focus behavior for chat input after activation
  useEffect(() => {
    if (isInputActivated) {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        // Don't interfere with form inputs, buttons, or modifier keys
        if (e.target instanceof HTMLInputElement || 
            e.target instanceof HTMLTextAreaElement || 
            e.target instanceof HTMLButtonElement ||
            e.ctrlKey || e.metaKey || e.altKey || 
            e.key === 'Tab' || e.key === 'Escape') {
          return;
        }
        
        // Focus input for normal typing
        if (e.key.length === 1 && inputRef.current) {
          inputRef.current.focus();
        }
      };

      window.addEventListener('keydown', handleGlobalKeyDown);
      return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }
  }, [isInputActivated]);

  useEffect(() => {
    if (inputRef.current && document.activeElement === inputRef.current) {
      const timeoutId = setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [messages]);
  useEffect(() => {
    // Only handle initial query if we don't have loaded messages (i.e., it's a new chat)
    if (initialQuery && !isInitialized && !isFromHistory && (!loadedMessages || loadedMessages.length === 0)) {
      console.log('ChatInterface: Initializing with query:', initialQuery);
      handleInitialQuery(initialQuery);
      setIsInitialized(true);
      setIsInputActivated(true);
      
      // Focus input after a brief delay to ensure component is ready
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    } else if (loadedMessages && loadedMessages.length > 0) {
      // If we have loaded messages, just mark as initialized without processing initialQuery
      setIsInitialized(true);
      setIsInputActivated(true);
    }
  }, [initialQuery, isInitialized, isFromHistory, loadedMessages]);
  const handleInitialQuery = async (query: string) => {
    try {
      const userMessage: Message = {
        id: `user-${Date.now()}`,
        content: query,
        role: 'user',
        timestamp: new Date()
      };
      const newMessages = [userMessage];
      setMessages(newMessages);
      onMessagesUpdate?.(newMessages);
      setIsTyping(true);
    
    // Scroll to bottom after user message
    scrollToShowResponse(false);
    
    setTimeout(async () => {
      let responseContent = '';
      let shouldShowProperties = false;
      
      try {
        // Use LLM to analyze the query
        const analysis = await analyzeQueryWithLLM(query, newMessages);
        console.log('LLM Analysis (initial query):', analysis);
        
        // Handle different response types
        console.log('LLM Analysis result:', analysis);
        console.log('Query:', query);
        console.log('Is property related (LLM):', analysis.isPropertyRelated);
        console.log('Is property related (fallback):', isPropertyRelatedQuery(query));
        
        // Always try property search for any query that might be property-related
        const shouldSearchProperties = analysis.isPropertyRelated || isPropertyRelatedQuery(query);
        
        if (shouldSearchProperties) {
          if (analysis.needsClarification) {
            responseContent = analysis.suggestedResponse || "I can help you find property comparables. Please specify: bedrooms, location, and price range.";
          } else {
            // Extract context from previous messages
            const context = extractContextFromMessages(newMessages);
            console.log('Extracted context:', context);
            
            // Merge LLM extracted criteria with context, but prioritize current query
            const searchCriteria = {
              bedrooms: analysis.extractedCriteria.bedrooms || context.bedrooms,
              bathrooms: analysis.extractedCriteria.bathrooms || context.bathrooms,
              location: analysis.extractedCriteria.location || context.location,
              priceRange: analysis.extractedCriteria.priceRange || context.priceRange
            };
            
            console.log('Search criteria before search:', searchCriteria);
            
            // Search for properties based on the query with context
            const searchResults = searchProperties(query, searchCriteria);
            
            if (searchResults.length > 0) {
              responseContent = analysis.suggestedResponse || `Found properties matching your criteria.`;
              shouldShowProperties = true;
              console.log('Setting property results:', searchResults);
              console.log('Property results length:', searchResults.length);
              console.log('First result bedrooms:', searchResults[0]?.bedrooms);
              setCurrentPropertyResults(searchResults);
              // Use ultra-aggressive scroll for property results to prevent cut-off
              setTimeout(() => {
                if (messagesEndRef.current) {
                  const element = messagesEndRef.current;
                  const elementRect = element.getBoundingClientRect();
                  const absoluteElementTop = elementRect.top + window.pageYOffset;
                  // Ultra-aggressive positioning to prevent any cut-off
                  const offset = 600; // Maximum offset to ensure no cut-off
                  const targetPosition = absoluteElementTop - offset;
                  window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                  });
                }
              }, 10);
              scrollToShowResponse(true);
            } else {
              // Generate a more helpful "no results" message
              const totalProperties = mockPropertyData.length;
              const availableBedrooms = [...new Set(mockPropertyData.map(p => p.bedrooms))].sort();
              const availableBathrooms = [...new Set(mockPropertyData.map(p => p.bathrooms))].sort();
              const availableLocations = [...new Set(mockPropertyData.map(p => {
                const addr = p.address.toLowerCase();
                if (addr.includes('clifton')) return 'Clifton';
                if (addr.includes('bristol')) return 'Bristol';
                if (addr.includes('filton')) return 'Filton';
                if (addr.includes('redland')) return 'Redland';
                if (addr.includes('montpelier')) return 'Montpelier';
                return 'Other areas';
              }))].filter(Boolean);
              
              const sampleProperties = mockPropertyData.slice(0, 3).map(p => 
                `• ${p.bedrooms} bed ${p.bathrooms} bath in ${p.address.split(',')[1]?.trim() || p.address.split(',')[0]} (£${p.price.toLocaleString()})`
              ).join('\n');
              
              responseContent = `No properties found matching your criteria. Available: ${availableBedrooms.join(', ')} bedrooms, areas: ${availableLocations.join(', ')}. Try "3 bed in Clifton" or "show all properties".`;
            }
          }
        } else {
          responseContent = analysis.suggestedResponse || `Hello. How can I help you today?`;
        }
      } catch (error) {
        console.error('Error in initial query processing:', error);
        responseContent = `I'd be happy to help you with "${query}". How can I assist you today?`;
      }
      
      const aiResponse: Message = {
        id: `ai-${Date.now()}`,
        content: responseContent,
        role: 'assistant',
        timestamp: new Date()
      };
      const updatedMessages = [...newMessages, aiResponse];
      setMessages(updatedMessages);
      onMessagesUpdate?.(updatedMessages);
      
      // Scroll to bottom after AI response
      scrollToShowResponse(false);
      
      // Track property-related responses that should show properties
      if (shouldShowProperties) {
        setPropertyQueries(prev => new Set([...prev, aiResponse.id]));
      }
      
      setIsTyping(false);
    }, 800);
    } catch (error) {
      console.error('Error in handleInitialQuery:', error);
      setIsTyping(false);
    }
  };
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() || isTyping) return;
    
    try {
    
    // Hide quick actions when user sends a message
    setShowQuickActions(false);
    
    // Capture the submitted text immediately to avoid race conditions with state updates
    const submittedText = inputValue.trim();
    const isPropertyRelated = isPropertyRelatedQuery(submittedText);
    
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      content: submittedText,
      role: 'user',
      timestamp: new Date()
    };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    onMessagesUpdate?.(newMessages);
    setInputValue("");
    setIsTyping(true);
    
    // Scroll to bottom after user message
    scrollToShowResponse(false);
    setTimeout(async () => {
      let responseContent = '';
      let shouldShowProperties = false;
      
      try {
        // Use LLM to analyze the query
        const analysis = await analyzeQueryWithLLM(submittedText, newMessages);
        console.log('LLM Analysis (send message):', analysis);
        
        // Handle different response types
        if (analysis.responseType === 'content_creation') {
          responseContent = analysis.suggestedResponse || "I can help you write property descriptions. What property details do you have?";
        } else if (analysis.responseType === 'data_analysis') {
          responseContent = analysis.suggestedResponse || "I can help analyze property data. What insights do you need?";
        } else if (analysis.isPropertyRelated || isPropertyRelatedQuery(submittedText)) {
          if (analysis.needsClarification) {
            responseContent = analysis.suggestedResponse || "I can help you find property comparables. Please specify: bedrooms, location, and price range.";
          } else {
            // Extract context from previous messages
            const context = extractContextFromMessages(newMessages);
            console.log('Extracted context (send message):', context);
            
            // Merge LLM extracted criteria with context, but prioritize current query
            const searchCriteria = {
              bedrooms: analysis.extractedCriteria.bedrooms || context.bedrooms,
              bathrooms: analysis.extractedCriteria.bathrooms || context.bathrooms,
              location: analysis.extractedCriteria.location || context.location,
              priceRange: analysis.extractedCriteria.priceRange || context.priceRange
            };
            
            console.log('Search criteria before search (send message):', searchCriteria);
            
            // Search for properties based on the query with context
            const searchResults = searchProperties(submittedText, searchCriteria);
            
            if (searchResults.length > 0) {
              responseContent = analysis.suggestedResponse || `Found properties matching your criteria.`;
              shouldShowProperties = true;
              console.log('Setting property results (send message):', searchResults);
              setCurrentPropertyResults(searchResults);
              // Use ultra-aggressive scroll for property results to prevent cut-off
              setTimeout(() => {
                if (messagesEndRef.current) {
                  const element = messagesEndRef.current;
                  const elementRect = element.getBoundingClientRect();
                  const absoluteElementTop = elementRect.top + window.pageYOffset;
                  // Ultra-aggressive positioning to prevent any cut-off
                  const offset = 600; // Maximum offset to ensure no cut-off
                  const targetPosition = absoluteElementTop - offset;
                  window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                  });
                }
              }, 10);
              scrollToShowResponse(true);
            } else {
              // Generate a more helpful "no results" message
              const totalProperties = mockPropertyData.length;
              const availableBedrooms = [...new Set(mockPropertyData.map(p => p.bedrooms))].sort();
              const availableBathrooms = [...new Set(mockPropertyData.map(p => p.bathrooms))].sort();
              const availableLocations = [...new Set(mockPropertyData.map(p => {
                const addr = p.address.toLowerCase();
                if (addr.includes('clifton')) return 'Clifton';
                if (addr.includes('bristol')) return 'Bristol';
                if (addr.includes('filton')) return 'Filton';
                if (addr.includes('redland')) return 'Redland';
                if (addr.includes('montpelier')) return 'Montpelier';
                return 'Other areas';
              }))].filter(Boolean);
              
              const sampleProperties = mockPropertyData.slice(0, 3).map(p => 
                `• ${p.bedrooms} bed ${p.bathrooms} bath in ${p.address.split(',')[1]?.trim() || p.address.split(',')[0]} (£${p.price.toLocaleString()})`
              ).join('\n');
              
              responseContent = `No properties found matching your criteria. Available: ${availableBedrooms.join(', ')} bedrooms, areas: ${availableLocations.join(', ')}. Try "3 bed in Clifton" or "show all properties".`;
            }
          }
        } else {
          responseContent = analysis.suggestedResponse || `Hello. How can I help you today?`;
        }
      } catch (error) {
        console.error('Error in send message processing:', error);
        responseContent = `I'd be happy to help you with "${submittedText}". How can I assist you today?`;
      }
      
      const aiResponse: Message = {
        id: `ai-${Date.now()}`,
        content: responseContent,
        role: 'assistant',
        timestamp: new Date()
      };
      const updatedMessages = [...newMessages, aiResponse];
      setMessages(updatedMessages);
      onMessagesUpdate?.(updatedMessages);
      
      // Scroll to bottom after AI response
      scrollToShowResponse(false);
      
      // Track property-related responses that should show properties
      if (shouldShowProperties) {
        setPropertyQueries(prev => new Set([...prev, aiResponse.id]));
      }
      
      setIsTyping(false);
    }, 600);
    } catch (error) {
      console.error('Error in handleSendMessage:', error);
      setIsTyping(false);
    }
  };
  const handleCopyMessage = async (content: string, messageId: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => {
        setCopiedMessageId(null);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };
  const handleThumbsUp = (messageId: string) => {
    setLikedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
        setDislikedMessages(prevDisliked => {
          const newDislikedSet = new Set(prevDisliked);
          newDislikedSet.delete(messageId);
          return newDislikedSet;
        });
      }
      return newSet;
    });
  };
  const handleThumbsDown = (messageId: string) => {
    setDislikedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) {
        newSet.delete(messageId);
      } else {
        newSet.add(messageId);
        setLikedMessages(prevLiked => {
          const newLikedSet = new Set(prevLiked);
          newLikedSet.delete(messageId);
          return newLikedSet;
        });
      }
      return newSet;
    });
  };

  const handleQuickAction = (query: string) => {
    setInputValue(query);
    setShowQuickActions(false);
    // Trigger the search
    setTimeout(() => {
      handleSendMessage({ preventDefault: () => {} } as React.FormEvent);
    }, 100);
  };

  const handleMapButtonClick = (messageId: string) => {
    setInlineMapMessageId(messageId);
    setShowInlineMap(true);
  };

  const handleCloseInlineMap = () => {
    setShowInlineMap(false);
    setInlineMapMessageId(null);
  };

  return (<motion.div initial={{
    opacity: 0,
    y: 4
  }} animate={{
    opacity: 1,
    y: 0
  }} transition={{
    duration: 0.2,
    ease: smoothEasing
  }} className={`fixed inset-0 flex flex-col h-screen w-screen relative ${className || ''}`}>
      {/* Fullscreen Chat Container - Plain White Background */}
      <div className="w-screen h-screen relative overflow-hidden">
        {/* White Background */}
        <div className="absolute inset-0 bg-white">
        </div>
        
        {/* Content Layer */}
        <div className="relative z-10 flex flex-col h-screen w-screen">

        {/* Messages Area - Centered like ChatGPT */}
        <div 
          ref={messagesContainerRef}
          className="flex-1 overflow-y-auto pt-16 pb-32 space-y-6 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200/50 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300/70"
          style={{
            scrollBehavior: 'smooth',
            scrollPaddingTop: '2rem',
            scrollPaddingBottom: '2rem',
            scrollSnapType: 'y proximity',
            scrollSnapAlign: 'start'
          }}
          onMouseEnter={() => {
            if (inputRef.current) {
              inputRef.current.focus();
            }
          }}
        >
          {/* Centered Content Container */}
          <div className="max-w-3xl mx-auto px-4 space-y-6">
          <AnimatePresence initial={false}>
            {messages.map((message, index) => {
              // Check if this is a property-related assistant message
              const isPropertyResponse = message.role === 'assistant' && propertyQueries.has(message.id);
              
              return <motion.div key={message.id} initial={isFromHistory ? { opacity: 1, y: 0, scale: 1 } : {
              opacity: 0,
              y: 6,
              scale: 0.98
            }} animate={{
              opacity: 1,
              y: 0,
              scale: 1
            }} exit={{
              opacity: 0,
              y: -4,
              scale: 0.98
            }} transition={isFromHistory ? { duration: 0 } : {
              duration: 0.15,
              ease: smoothEasing,
              delay: index * 0.02
            }} className="space-y-4">
                {/* User Message or Non-Property Assistant Message */}
                {!isPropertyResponse && (
                  <div className={`flex ${message.role === 'user' ? 'justify-end pr-4' : 'justify-start'}`}>
                    <div className={`flex max-w-[85%] ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'} items-start space-x-3`}>
                      {/* Message Content */}
                      <motion.div className={`group relative ${message.role === 'user' ? 'px-3 py-1.5 rounded-xl text-slate-800 shadow-sm bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100/30' : 'text-slate-700'}`} whileHover={{
                    y: message.role === 'user' ? -1 : 0,
                    scale: message.role === 'user' ? 1.01 : 1
                  }} transition={{
                    duration: 0.15,
                    ease: [0.25, 0.1, 0.25, 1]
                  }}>
                        <motion.p className="text-xs leading-relaxed whitespace-pre-wrap font-medium">
                          <motion.span initial={{
                        opacity: 0,
                        y: 2
                      }} animate={{
                        opacity: 1,
                        y: 0
                      }} transition={{
                        duration: 0.12,
                        ease: preciseEasing,
                        delay: message.role === 'assistant' ? 0.05 : 0.02
                      }}>
                            {message.content}
                          </motion.span>
                        </motion.p>
                        
                        {/* Message Actions */}
                        {message.role === 'assistant' && <motion.div className="flex items-center space-x-3 mt-4 opacity-0 group-hover:opacity-100 transition-all duration-150" initial={{
                      y: 2,
                      opacity: 0
                    }} whileHover={{
                      y: 0,
                      opacity: 1
                    }} transition={{
                      duration: 0.1,
                      ease: snapEasing
                    }}>
                            <motion.button whileHover={{
                        scale: 1.08
                      }} whileTap={{
                        scale: 0.92
                      }} transition={{
                        duration: 0.08,
                        ease: snapEasing
                      }} onClick={() => handleCopyMessage(message.content, message.id)} className={`w-8 h-8 flex items-center justify-center transition-all duration-100 rounded-xl ${copiedMessageId === message.id ? 'text-emerald-500 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}>
                              {copiedMessageId === message.id ? <Check className="w-4 h-4" strokeWidth={1.5} /> : <Copy className="w-4 h-4" strokeWidth={1.5} />}
                            </motion.button>
                            
                            <motion.button whileHover={{
                        scale: 1.08
                      }} whileTap={{
                        scale: 0.92
                      }} transition={{
                        duration: 0.08,
                        ease: snapEasing
                      }} onClick={() => handleThumbsUp(message.id)} className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all duration-100 ${likedMessages.has(message.id) ? 'text-emerald-500 bg-emerald-50 hover:bg-emerald-100 shadow-[0_0_8px_rgba(34,197,94,0.15)]' : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50'}`}>
                              <ThumbsUp className="w-4 h-4" strokeWidth={1.5} />
                            </motion.button>
                            
                            <motion.button whileHover={{
                        scale: 1.08
                      }} whileTap={{
                        scale: 0.92
                      }} transition={{
                        duration: 0.08,
                        ease: snapEasing
                      }} onClick={() => handleThumbsDown(message.id)} className={`w-8 h-8 flex items-center justify-center rounded-xl transition-all duration-100 ${dislikedMessages.has(message.id) ? 'text-red-500 bg-red-50 hover:bg-red-100 shadow-[0_0_8px_rgba(239,68,68,0.15)]' : 'text-slate-400 hover:text-red-500 hover:bg-red-50'}`}>
                              <ThumbsDown className="w-4 h-4" strokeWidth={1.5} />
                            </motion.button>
                          </motion.div>}
                      </motion.div>
                    </div>
                  </div>
                )}
                
                {/* Property Results Display for Property Messages */}
                {isPropertyResponse && (
                  <motion.div initial={{
                    opacity: 0,
                    y: 12,
                    scale: 0.98
                  }} animate={{
                    opacity: 1,
                    y: 0,
                    scale: 1
                  }} transition={{
                    duration: 0.2,
                    delay: 0.15,
                    ease: smoothEasing
                  }} className="flex justify-start pl-4">
                    <div className="w-full max-w-2xl">
                      <PropertyResultsDisplay 
                        properties={currentPropertyResults} 
                        onMapButtonClick={() => handleMapButtonClick(message.id)}
                      />
                    </div>
                  </motion.div>
                )}
              </motion.div>
            })}
          </AnimatePresence>

          {/* Typing indicator */}
          <AnimatePresence>
            {isTyping && <motion.div key="typing" initial={{
            opacity: 0,
            y: 6,
            scale: 0.98
          }} animate={{
            opacity: 1,
            y: 0,
            scale: 1
          }} exit={{
            opacity: 0,
            y: -4,
            scale: 0.98
          }} transition={{
            duration: 0.15,
            ease: smoothEasing
          }} className="flex justify-start">
                <div className="flex justify-start">
                  <motion.div 
                    className="w-2 h-2 bg-green-500 rounded-full ml-4"
                    animate={{
                      scale: [1, 1.2, 1],
                      opacity: [0.6, 1, 0.6]
                    }}
                    transition={{
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                  />
                </div>
              </motion.div>}
          </AnimatePresence>

          <div ref={messagesEndRef} />
        </div>
        </div>

        {/* Inline Map */}
        <AnimatePresence>
          {showInlineMap && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="mx-4 mb-4 bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden"
            >
              {/* Map Header */}
              <div className="flex items-center justify-between p-4 border-b border-slate-200">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Property Comparables Map</h3>
                  <p className="text-sm text-slate-600">Showing {currentPropertyResults.length} comparable properties</p>
                </div>
                <button
                  onClick={handleCloseInlineMap}
                  className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
                >
                  <X className="w-4 h-4 text-slate-600" />
                </button>
        </div>

              {/* Map Container */}
              <div className="h-96">
                <SquareMap
                  isVisible={true}
                  searchQuery=""
                  onLocationUpdate={() => {}}
                  onSearch={() => {}}
                  hasPerformedSearch={true}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Quick Action Buttons */}
        <AnimatePresence>
          {showQuickActions && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="absolute bottom-24 left-0 right-0 z-40 px-4"
            >
              <div className="max-w-3xl mx-auto">
                <div className="flex flex-wrap gap-2 justify-center">
                  {[
                    "Show me property comparables",
                    "Find houses in the area", 
                    "Get market analysis",
                    "Search for properties"
                  ].map((action, index) => (
                    <motion.button
                      key={action}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.1, duration: 0.2 }}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleQuickAction(action)}
                      className="px-4 py-2 bg-white/80 backdrop-blur-sm border border-white/40 rounded-full text-sm font-medium text-slate-700 hover:bg-white/90 hover:border-white/60 transition-all duration-200 shadow-sm hover:shadow-md"
                    >
                      {action}
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>
        </div>
        {/* Chat Input at Bottom - Centered */}
        <div className="absolute bottom-6 left-0 right-0 z-50 px-4">
          <div className="max-w-3xl mx-auto">
          <form onSubmit={handleSendMessage} className="relative">
              <motion.div 
                className="relative flex items-center rounded-full px-6 py-2 transition-all duration-300 ease-out border border-slate-300"
                style={{
                  background: 'rgba(255, 255, 255, 0.15)',
                  backdropFilter: 'blur(20px)',
                  borderRadius: '9999px',
                  WebkitBackdropFilter: 'blur(20px)',
                  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.1)'
                }}
                animate={{
                  scale: 1
                }}
                transition={{
                  duration: 0.2,
                  ease: "easeOut"
                }}
                whileHover={{
                  scale: 1.003
                }}
                whileTap={{
                  scale: 0.995
                }}
              >
              <motion.input 
                ref={inputRef} 
                type="text" 
                value={inputValue} 
                onChange={e => setInputValue(e.target.value)} 
                onFocus={() => {
                  setIsInputActivated(true);
                  setIsFocused(true);
                }}
                onBlur={() => setIsFocused(false)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (inputValue.trim() && !isTyping) {
                      handleSendMessage(e as any);
                    }
                  }
                }} 
                placeholder="Ask anything..." 
                className="flex-1 bg-transparent focus:outline-none text-lg font-normal text-slate-700 placeholder:text-slate-500 placeholder:font-light placeholder:tracking-wide" 
                disabled={isTyping} 
                animate={{
                  scale: 1
                }}
                whileFocus={{
                  scale: 1.002
                }}
                transition={{
                  duration: 0.15,
                  ease: "easeOut"
                }}
              />
              
              <ImageUploadButton
                onImageUpload={(query) => {
                  setInputValue(query);
                  handleSendMessage({ preventDefault: () => {} } as any);
                }}
                size="md"
              />
              
              <motion.button 
                type="submit" 
                disabled={!inputValue.trim() || isTyping} 
                className={`ml-3 w-8 h-8 flex items-center justify-center rounded-full transition-all duration-200 ${
                inputValue.trim() && !isTyping 
                    ? 'bg-slate-600 text-white hover:bg-green-500' 
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
                whileHover={inputValue.trim() && !isTyping ? { 
                  scale: 1.05
                } : {}}
                whileTap={inputValue.trim() && !isTyping ? { 
                  scale: 0.95
                } : {}}
                transition={{
                  duration: 0.15,
                  ease: "easeOut"
                }}
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2} />
              </motion.button>
            </motion.div>
          </form>
          </div>
        </div>
    </motion.div>
  );
}