import React, { useState, useRef, useEffect } from 'react';

const ChatArea = ({ chatMessages, onSendMessage }) => {
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef(null);

  // Scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  // Handle sending a message
  const handleSubmit = (e) => {
    e.preventDefault();
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  // Format timestamp for each message
  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  };

  return (
    // MAIN CHAT AREA CONTAINER (fills available space in parent)
    <div className="flex-1 bg-white border-l border-[#e5e7eb] flex flex-col h-full min-w-0">
      {/* HEADER */}
      <div className="flex border-b border-[#e5e7eb] px-6 py-4 bg-white">
        <h2 className="text-xl font-bold text-[#4f46e5]">Agent Chat</h2>
      </div>
      {/* MESSAGES LIST (scrollable area) */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {chatMessages.map((msg) => (
          // SINGLE MESSAGE ROW
          <div key={msg.id} className={`flex items-end gap-3 ${msg.is_user ? 'justify-end' : ''}`}>
            {/* AVATAR (AI) */}
            {!msg.is_user && (
              <div 
                className="bg-center bg-no-repeat aspect-square bg-cover rounded-full w-8 shrink-0"
                style={{ backgroundImage: "url('/images/ai-avatar.png')" }}
              ></div>
            )}
            {/* MESSAGE BUBBLE */}
            <div className="flex flex-col gap-1 max-w-[70%]">
              <div className={`rounded-2xl px-4 py-2 ${
                msg.is_user 
                  ? 'bg-[#e0e7ff] text-[#3730a3]' 
                  : 'bg-[#f3f4f6] text-[#111827]'
              }`}>
                <p className="text-base font-normal">{msg.content}</p>
              </div>
              <p className="text-[#9ca3af] text-xs">{formatTime(msg.timestamp)}</p>
            </div>
            {/* AVATAR (User) */}
            {msg.is_user && (
              <div 
                className="bg-center bg-no-repeat aspect-square bg-cover rounded-full w-8 shrink-0"
                style={{ backgroundImage: "url('/images/user-avatar.png')" }}
              ></div>
            )}
          </div>
        ))}
        {/* Dummy div to scroll to bottom */}
        <div ref={messagesEndRef} />
      </div>
      {/* INPUT BAR (fixed at bottom of chat area, full width) */}
      <div className="p-4 border-t border-[#e5e7eb] bg-[#f9fafb] w-full">
        <form onSubmit={handleSubmit} className="flex gap-3">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message here..."
            autoComplete="off"
            rows="1"
            style={{ resize: 'none', overflow: 'hidden', minHeight: '40px' }}
            className="flex-1 rounded-lg border border-[#e5e7eb] px-4 py-2 text-base text-[#111827] focus:outline-none focus:border-[#6366f1]"
            onInput={(e) => {
              e.target.style.height = '40px';
              e.target.style.height = (e.target.scrollHeight) + 'px';
            }}
          />
          <button 
            type="submit" 
            className="rounded-lg h-10 w-12 flex items-center justify-center bg-[#6366f1] hover:bg-[#4f46e5] transition-colors"
            aria-label="Send"
          >
            {/* Play/arrow icon as send button */}
            <svg width="28" height="28" viewBox="0 0 225 225" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <polygon points="0,0 225,112.5 0,225" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatArea; 