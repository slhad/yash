import { beforeEach, describe, expect, test } from 'bun:test';
import type { ChatMessage } from '../src/platforms/base';
import { KickProvider } from '../src/platforms/kick';
import { TwitchProvider } from '../src/platforms/twitch';
import { ChatService } from '../src/services/chat.service';

describe('ChatService', () => {
  let chatService: ChatService;
  let twitchProvider: TwitchProvider;
  let kickProvider: KickProvider;

  beforeEach(() => {
    chatService = new ChatService();
    twitchProvider = new TwitchProvider();
    kickProvider = new KickProvider();
  });

  test('should be instantiable', () => {
    expect(chatService).toBeInstanceOf(ChatService);
  });

  test('should register providers', () => {
    chatService.registerProvider('twitch', twitchProvider);
    chatService.registerProvider('kick', kickProvider);

    expect(chatService.isPlatformRegistered('twitch')).toBe(true);
    expect(chatService.isPlatformRegistered('kick')).toBe(true);
    expect(chatService.getRegisteredPlatforms()).toEqual(['twitch', 'kick']);
  });

  test('should receive messages from providers', () => {
    let receivedMessage: ChatMessage | null = null;
    const unsubscribe = chatService.subscribeToMessages((msg) => {
      receivedMessage = msg;
    });

    chatService.registerProvider('twitch', twitchProvider);
    twitchProvider._simulateMessage('Hello chat!', 'TestUser');

    expect(receivedMessage).not.toBeNull();
    expect(receivedMessage?.platform).toBe('twitch');
    expect(receivedMessage?.message).toBe('Hello chat!');
    expect(receivedMessage?.username).toBe('TestUser');

    unsubscribe();
  });

  test('should normalize incoming messages', () => {
    let receivedMessage: ChatMessage | null = null;
    chatService.subscribeToMessages((msg) => {
      receivedMessage = msg;
    });

    chatService.registerProvider('kick', kickProvider);
    kickProvider._simulateMessage('Test message', 'KickUser');

    expect(receivedMessage).not.toBeNull();
    expect(receivedMessage?.id).toBeDefined();
    expect(receivedMessage?.timestamp).toBeDefined();
    expect(receivedMessage?.userId).toBeDefined();

    chatService.clearHistory();
  });

  test('should maintain message history', () => {
    chatService.registerProvider('twitch', twitchProvider);

    twitchProvider._simulateMessage('Message 1', 'User1');
    twitchProvider._simulateMessage('Message 2', 'User2');

    const history = chatService.getMessageHistory();
    expect(history.length).toBe(2);
    expect(history[0]?.message).toBe('Message 1');
    expect(history[1]?.message).toBe('Message 2');
  });

  test('should filter history by platform', () => {
    chatService.registerProvider('twitch', twitchProvider);
    chatService.registerProvider('kick', kickProvider);

    twitchProvider._simulateMessage('Twitch msg', 'TwitchUser');
    kickProvider._simulateMessage('Kick msg', 'KickUser');

    const twitchHistory = chatService.getMessageHistoryForPlatforms(['twitch']);
    expect(twitchHistory.length).toBe(1);
    expect(twitchHistory[0]?.platform).toBe('twitch');

    const kickHistory = chatService.getMessageHistoryForPlatforms(['kick']);
    expect(kickHistory.length).toBe(1);
    expect(kickHistory[0]?.platform).toBe('kick');

    const allHistory = chatService.getMessageHistoryForPlatforms([]);
    expect(allHistory.length).toBe(2);
  });

  test('should respect max history size', () => {
    chatService.setMaxHistorySize(3);
    chatService.registerProvider('twitch', twitchProvider);

    twitchProvider._simulateMessage('Msg 1', 'User1');
    twitchProvider._simulateMessage('Msg 2', 'User2');
    twitchProvider._simulateMessage('Msg 3', 'User3');
    twitchProvider._simulateMessage('Msg 4', 'User4');

    const history = chatService.getMessageHistory();
    expect(history.length).toBe(3);
    expect(history[0]?.message).toBe('Msg 2');
  });

  test('should clear history', () => {
    chatService.registerProvider('twitch', twitchProvider);

    twitchProvider._simulateMessage('Message', 'User');
    expect(chatService.getMessageHistory().length).toBe(1);

    chatService.clearHistory();
    expect(chatService.getMessageHistory().length).toBe(0);
  });

  test('should unsubscribe from messages', () => {
    let callCount = 0;
    const unsubscribe = chatService.subscribeToMessages(() => {
      callCount++;
    });

    chatService.registerProvider('twitch', twitchProvider);
    twitchProvider._simulateMessage('Message 1', 'User');
    expect(callCount).toBe(1);

    unsubscribe();
    twitchProvider._simulateMessage('Message 2', 'User');
    expect(callCount).toBe(1);
  });

  test('should send message to specific platforms', async () => {
    (twitchProvider as any).isAuthenticatedFlag = true; // bypass OAuth — real credentials may be present
    (kickProvider as any).isAuthenticatedFlag = true;
    chatService.registerProvider('twitch', twitchProvider);
    chatService.registerProvider('kick', kickProvider);

    await chatService.sendMessage('Test', ['twitch']);

    const history = chatService.getMessageHistory();
    expect(history.length).toBe(0);
  });
});
