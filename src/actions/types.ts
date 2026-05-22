import type { PlatformProvider } from '../platforms/base';
import type { ChatService } from '../services/chat.service';

export type ActionArgSchema =
  | { type: 'string'; required?: boolean; minLength?: number; maxLength: number }
  | { type: 'boolean'; required?: boolean }
  | { type: 'number'; required?: boolean; min?: number; max?: number }
  | { type: 'enum'; required?: boolean; values: string[] };

export type ActionSafety = 'safe' | 'confirm' | 'dangerous' | 'blocked';
export type ActionVisibility = 'public' | 'internal';

export type ActionContext = {
  chatService: ChatService;
  providers: Record<string, PlatformProvider>;
  emit?: (line: string) => void;
};

export type ActionResult = {
  output?: string[];
  data?: Record<string, unknown>;
  warnings?: string[];
};

export type YashActionDefinition = {
  id: string;
  title: string;
  description: string;
  domain: string;
  ipcEnabled: boolean;
  readOnly: boolean;
  safety: ActionSafety;
  visibility: ActionVisibility;
  deprecated?: boolean;
  voiceHint?: boolean;
  scriptHint?: boolean;
  args: Record<string, ActionArgSchema>;
  examples?: Array<{ args: Record<string, unknown>; description?: string }>;
  invoke: (args: Record<string, unknown>, ctx: ActionContext) => Promise<ActionResult>;
};

export type IpcRequest =
  | { type: 'list_actions'; details?: boolean }
  | { type: 'describe_action'; action: string }
  | { type: 'invoke_action'; action: string; args?: Record<string, unknown> }
  | { type: 'command'; command: string };

export const IPC_ERROR_CODES = {
  UNKNOWN_REQUEST_TYPE: 'unknown_request_type',
  UNKNOWN_ACTION: 'unknown_action',
  INVALID_ARGS: 'invalid_args',
  ACTION_BLOCKED: 'action_blocked',
  ACTION_UNAVAILABLE: 'action_unavailable',
  PROVIDER_NOT_CONNECTED: 'provider_not_connected',
  OBS_NOT_CONNECTED: 'obs_not_connected',
  NOT_SUPPORTED_IN_CURRENT_STATE: 'not_supported_in_current_state',
  REQUIRES_CONFIRMATION: 'requires_confirmation',
  INTERNAL_ERROR: 'internal_error',
} as const;

export type IpcErrorCode = (typeof IPC_ERROR_CODES)[keyof typeof IPC_ERROR_CODES];

export type IpcResponse =
  | {
      ok: true;
      result: {
        action: string;
        output?: string[];
        data?: Record<string, unknown>;
        warnings?: string[];
      };
    }
  | {
      ok: false;
      error: { code: IpcErrorCode; message: string; details?: Record<string, unknown> };
    };
