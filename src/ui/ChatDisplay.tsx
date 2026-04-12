import React from 'react';

// ChatDisplay component for showing chat messages
interface ChatDisplayProps {
  messages: Array<{
    id: string;
    platform: string;
    username: string;
    message: string;
    timestamp: number;
  }>;
  showTimestamps?: boolean;
}

export const ChatDisplay: React.FC<ChatDisplayProps> = ({ messages, showTimestamps = true }) => {
  return (
    <div className="chat-display">
      {messages.map((msg) => (
        <div key={msg.id} className={`chat-message platform-${msg.platform}`}>
          {showTimestamps && (
            <span className="message-time">{new Date(msg.timestamp).toLocaleTimeString()}</span>
          )}
          <span className="message-platform">[{msg.platform}]</span>
          <span className="message-username">{msg.username}:</span>
          <span className="message-text">{msg.message}</span>
        </div>
      ))}

      {/* Auto-scroll to bottom would be handled by the component */}
      <div className="chat-spacer" />
    </div>
  );
};

// In a real implementation with OpenTUI, this would use their components
// For example:
// import { Box, Text } from '@opentui/components';
//
// export const ChatDisplay: React.FC<ChatDisplayProps> = ({ messages }) => {
//   return (
//     <Box height={30}>
//       {messages.map(msg => (
//         <Text key={msg.id}>
//           [{msg.platform}] {msg.username}: {msg.message}
//         </Text>
//       ))}
//     </Box>
//   );
// };
