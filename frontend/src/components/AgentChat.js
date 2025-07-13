import React, { useState, useRef, useEffect } from 'react';

export default function AgentChat({ chatMessages = [], onSendMessage }) {
  const [message, setMessage] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleSend = (e) => {
    e.preventDefault();
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  return (
    <div className="w-96 bg-white border-l flex flex-col h-full">
      {/* Fixed Chat Header */}
      <div className="p-6 border-b flex-shrink-0">
        <h2 className="text-xl font-semibold text-blue-700">Agent Chat</h2>
      </div>
      {/* Scrollable Messages Area */}
      <div className="flex-1 p-6 overflow-hidden">
        <div className="h-full overflow-y-auto pr-2">
          <div className="space-y-4">
            {chatMessages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.is_user ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-xs p-3 rounded-lg ${msg.is_user ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'}`}>
                  <p className="text-sm">{msg.content}</p>
                  <p className={`text-xs mt-1 ${msg.is_user ? 'text-blue-100' : 'text-gray-500'}`}>{
                    new Date(msg.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                  }</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>
      {/* Fixed Input Area */}
      <div className="p-6 border-t flex-shrink-0">
        <form className="flex gap-2" onSubmit={handleSend}>
          <input
            type="text"
            placeholder="Type your message here..."
            value={message}
            onChange={e => setMessage(e.target.value)}
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-base focus:outline-none focus:border-blue-400"
            autoComplete="off"
          />
          <button
            type="submit"
            className="rounded-lg h-10 w-12 flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            aria-label="Send"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <polygon points="2,21 23,12 2,3 2,10 17,12 2,14" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
} 