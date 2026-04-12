import { createRoot } from 'react-dom/client';
import { KickProvider } from './platforms/kick';
import { TwitchProvider } from './platforms/twitch';
import { YouTubeProvider } from './platforms/youtube';
import { ChatService } from './services/chat.service';
import { ObsService } from './services/obs.service';
import { StreamService } from './services/stream.service';
import { Dashboard } from './ui/Dashboard';

const youtube = new YouTubeProvider();
const twitch = new TwitchProvider();
const kick = new KickProvider();

const chatService = new ChatService();
const streamService = new StreamService();
const obsService = new ObsService('localhost', 4455, null);

chatService.registerProvider('youtube', youtube);
chatService.registerProvider('twitch', twitch);
chatService.registerProvider('kick', kick);

streamService.registerProvider('youtube', youtube);
streamService.registerProvider('twitch', twitch);
streamService.registerProvider('kick', kick);

const platforms = ['youtube', 'twitch', 'kick'];

async function authenticateAll() {
  await Promise.all([youtube.authenticate(), twitch.authenticate(), kick.authenticate()]);
}

async function connectObs() {
  try {
    await obsService.connect();
  } catch {
    console.log('OBS not available');
  }
}

function transformMessage(msg: { platform: string; username: string; message: string }) {
  return `[${msg.platform}] ${msg.username}: ${msg.message}`;
}

function App() {
  const handleAuthenticate = async (platform: string) => {
    const provider = { youtube, twitch, kick }[platform];
    if (provider) {
      await provider.authenticate();
    }
  };

  const handleStartStream = async (platforms: string[], metadata: any) => {
    await streamService.startStream(platforms, metadata);
  };

  const handleStopStream = async (platforms: string[]) => {
    await streamService.stopStream(platforms);
  };

  const handleUpdateMetadata = async (platforms: string[], metadata: any) => {
    await streamService.updateStreamMetadata(platforms, metadata);
  };

  const handleSendMessage = async (message: string, targetPlatforms: string[]) => {
    await chatService.sendMessage(message, targetPlatforms);
  };

  const getPlatformStatus = (platform: string) => {
    const provider = { youtube, twitch, kick }[platform];
    return provider
      ? provider.getStatus()
      : {
          authenticated: false,
          streamStatus: 'OFFLINE',
          connectionStatus: 'disconnected',
          lastError: null,
        };
  };

  const getObsStatus = () => obsService.isConnected();

  const getChatMessages = () => {
    return chatService.getMessageHistory().map((msg) => ({
      id: msg.id,
      platform: msg.platform,
      username: msg.username,
      message: msg.message,
      timestamp: msg.timestamp,
    }));
  };

  return (
    <Dashboard
      platforms={platforms}
      onAuthenticate={handleAuthenticate}
      onStartStream={handleStartStream}
      onStopStream={handleStopStream}
      onUpdateMetadata={handleUpdateMetadata}
      onSendMessage={handleSendMessage}
      getPlatformStatus={getPlatformStatus}
      getObsStatus={getObsStatus}
      getChatMessages={getChatMessages}
    />
  );
}

const init = async () => {
  await authenticateAll();
  await connectObs();

  chatService.subscribeToMessages((msg) => {
    console.log('Chat:', transformMessage(msg));
  });

  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(<App />);
  }
};

init().catch(console.error);
