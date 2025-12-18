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
