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
