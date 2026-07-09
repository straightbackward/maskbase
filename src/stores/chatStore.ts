import { create } from 'zustand';
import { Message } from '../types';
import { sendChatMessage } from '../services/api';

interface ChatState {
  messages: Message[];
  isThinking: boolean;
  chatMessages: Record<string, Message[]>;

  sendMessage: (text: string, sessionIds: string[], chatId: string, model?: string, provider?: string) => Promise<void>;
  loadChatMessages: (chatId: string) => void;
  reset: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isThinking: false,
  chatMessages: {},

  loadChatMessages: (chatId: string) => {
    const cached = get().chatMessages[chatId];
    set({ messages: cached || [] });
  },

  sendMessage: async (text: string, sessionIds: string[], chatId: string, model?: string, provider?: string) => {
    const userMessage: Message = { role: 'user', text, timestamp: Date.now() };

    set((state) => {
      const updated = [...state.messages, userMessage];
      return {
        messages: updated,
        isThinking: true,
        chatMessages: { ...state.chatMessages, [chatId]: updated },
      };
    });

    try {
      const response = await sendChatMessage(sessionIds, chatId, text, model, provider);
      const aiMessage: Message = {
        role: 'ai',
        text: response.redacted_response,
        deanonymizedText: response.response,
        timestamp: Date.now(),
      };

      set((state) => {
        const updated = [...state.messages, aiMessage];
        return {
          messages: updated,
          isThinking: false,
          chatMessages: { ...state.chatMessages, [chatId]: updated },
        };
      });
    } catch (err: any) {
      const errMsg = err?.message || 'Unknown chat error';

      // Strip the "Chat failed: " prefix added by the backend for unexpected errors
      const userFacingMsg = errMsg.startsWith('Chat failed: ')
        ? errMsg.slice('Chat failed: '.length)
        : errMsg;

      const errorMessage: Message = {
        role: 'ai',
        text: userFacingMsg,
        timestamp: Date.now(),
      };

      set((state) => {
        const updated = [...state.messages, errorMessage];
        return {
          messages: updated,
          isThinking: false,
          chatMessages: { ...state.chatMessages, [chatId]: updated },
        };
      });
    }
  },

  reset: () => set({ messages: [], isThinking: false }),
}));
