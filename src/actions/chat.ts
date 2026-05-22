import { IpcActionError, registry } from './registry';
import { IPC_ERROR_CODES, type YashActionDefinition } from './types';

export const chatSendAction: YashActionDefinition = {
  id: 'chat.send',
  title: 'Send chat message',
  description: 'Send a message to one or all connected chat platforms.',
  domain: 'chat',
  ipcEnabled: true,
  readOnly: false,
  safety: 'safe',
  visibility: 'public',
  args: {
    platform: {
      type: 'enum',
      required: true,
      values: ['youtube', 'twitch', 'kick', 'all'],
    },
    text: {
      type: 'string',
      required: true,
      minLength: 1,
      maxLength: 500,
    },
  },
  examples: [
    { args: { platform: 'twitch', text: 'hello chat' }, description: 'Send to Twitch only' },
    { args: { platform: 'all', text: 'hello everyone' }, description: 'Send to all platforms' },
  ],
  async invoke(args, ctx) {
    const platform = args.platform as string;
    const text = args.text as string;

    const targetPlatforms = platform === 'all' ? [] : [platform];

    try {
      await ctx.chatService.sendMessage(text, targetPlatforms);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNotConnected = /not authenticated|not connected|credentials not configured/i.test(
        msg,
      );
      if (isNotConnected) {
        throw new IpcActionError(IPC_ERROR_CODES.PROVIDER_NOT_CONNECTED, msg);
      }
      throw err;
    }

    return {
      output: [`[chat] ${platform}: ${text} sent`],
      data: {
        sent: { platform, text },
      },
    };
  },
};

registry.registerAction(chatSendAction);
