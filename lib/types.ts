/**
 * Core type definitions for the application
 */

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: Message[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface ServerSettings {
  limitConversations: number;
  rps: number;
  fullSyncOnLoad: boolean;
}

export interface ServerItem {
  id: string;
  url: string;
  label?: string;
}

export interface ConversationData {
  id: string;
  title?: string;
  chat?: {
    messages?: Record<string, MessageNode>;
    history?: {
      messages: Record<string, MessageNode>;
      currentId?: string;
    };
    currentId?: string;
    title?: string;
    timestamp?: number;
  };
  messages?: MessageNode[]; // Some API versions might use different structure
  updated_at?: number;
  updatedAt?: number;
  created_at?: number;
  timestamp?: number;
  archived?: boolean;
}

export interface MessageNode {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parentId?: string | null;
  timestamp?: number;
}

export type ChatCompletionBody = ChatCompletionRequest | { uiText: string };

export type WebViewMessage =
  | { type: "debug"; message: string; scope?: string; event?: string; [key: string]: unknown }
  | {
      type: "swStatus";
      status?: number | string;
      hasSW: boolean;
      swFunctional?: boolean;
      method?: string;
      error?: string;
    }
  | { type: "drainBatchResult"; sent: number; remaining: number; successIds: string[] }
  | { type: "drainBatchError"; error: string }
  | { type: "authToken"; token: string }
  | { type: "themeProbe"; payload: unknown }
  | { type: "syncDone"; conversations: number; messages: number }
  | { type: "queueMessage"; chatId: string; body: ChatCompletionBody }
  | { type: "externalLink"; url: string }
  | { type: "cacheResponse"; url: string; data: unknown; title?: string }
  | { type: "downloadBlob"; base64: string; filename: string; mime: string };
