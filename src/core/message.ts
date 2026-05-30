import {
  Message,
  MessageId,
  MessageType,
  MessageMetadata,
  AgentId,
  HandoffMessage,
  BroadcastMessage,
} from './types.js';

let messageIdCounter = 0;

function generateMessageId(): MessageId {
  return `msg_${Date.now()}_${++messageIdCounter}` as MessageId;
}

export interface CreateMessageOptions<T = unknown> {
  senderId: AgentId;
  receiverId?: AgentId;
  type?: MessageType;
  content: T;
  metadata?: MessageMetadata;
}

export class MessageFactory {
  static create<T = unknown>(options: CreateMessageOptions<T>): Message<T> {
    return {
      id: generateMessageId(),
      senderId: options.senderId,
      receiverId: options.receiverId,
      type: options.type ?? 'direct',
      content: options.content,
      timestamp: Date.now(),
      metadata: options.metadata,
    };
  }

  static createRequest<T = unknown>(
    senderId: AgentId,
    receiverId: AgentId,
    content: T,
    metadata?: MessageMetadata
  ): Message<T> {
    return this.create({
      senderId,
      receiverId,
      type: 'request',
      content,
      metadata,
    });
  }

  static createResponse<T = unknown>(
    senderId: AgentId,
    receiverId: AgentId,
    content: T,
    replyTo: MessageId,
    metadata?: MessageMetadata
  ): Message<T> {
    return this.create({
      senderId,
      receiverId,
      type: 'response',
      content,
      metadata: {
        ...metadata,
        replyTo,
      },
    });
  }

  static createTask<T = unknown>(
    senderId: AgentId,
    receiverId: AgentId,
    taskData: T,
    _taskId?: string,
    metadata?: MessageMetadata
  ): Message<T> {
    return this.create({
      senderId,
      receiverId,
      type: 'task',
      content: taskData,
      metadata: {
        ...metadata,
      },
    });
  }

  static createHandoff<T = unknown>(
    senderId: AgentId,
    receiverId: AgentId,
    taskData: T,
    _taskId?: string,
    context?: Record<string, unknown>
  ): HandoffMessage<T> {
    return {
      id: generateMessageId(),
      senderId,
      receiverId,
      type: 'handoff',
      content: taskData,
      timestamp: Date.now(),
      fromAgent: senderId,
      toAgent: receiverId,
      task: taskData as never,
      context: context as never,
    };
  }

  static createBroadcast<T = unknown>(
    senderId: AgentId,
    content: T,
    excludedAgents?: AgentId[],
    metadata?: MessageMetadata
  ): BroadcastMessage<T> {
    return {
      id: generateMessageId(),
      senderId,
      type: 'broadcast',
      content,
      timestamp: Date.now(),
      excludedAgents,
      metadata,
    };
  }

  static createError(
    senderId: AgentId,
    receiverId: AgentId,
    error: Error,
    replyTo?: MessageId
  ): Message<{ error: string; message: string; stack?: string }> {
    return this.create({
      senderId,
      receiverId,
      type: 'error',
      content: {
        error: error.name ?? 'Error',
        message: error.message,
        stack: error.stack,
      },
      metadata: replyTo ? { replyTo } : undefined,
    });
  }

  static createStatus(
    senderId: AgentId,
    status: string,
    metadata?: MessageMetadata
  ): Message<{ status: string }> {
    return this.create({
      senderId,
      type: 'status',
      content: { status },
      metadata,
    });
  }
}

export type MessageHandler<T = unknown> = (
  message: Message<T>
) => Promise<void> | void;

export interface MessageBusOptions {
  enableLogging?: boolean;
  enableTracing?: boolean;
  maxQueueSize?: number;
}

export class MessageBus {
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private messageQueue: Array<Message> = [];
  private options: Required<MessageBusOptions>;

  constructor(options: MessageBusOptions = {}) {
    this.options = {
      enableLogging: options.enableLogging ?? false,
      enableTracing: options.enableTracing ?? false,
      maxQueueSize: options.maxQueueSize ?? 1000,
    };
  }

  subscribe(type: MessageType | '*', handler: MessageHandler): () => void {
    const key = type === '*' ? '*' : type;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    const handlers = this.handlers.get(key);
    if (handlers) {
      handlers.add(handler);
    }

    return () => {
      const handlersForUnsubscribe = this.handlers.get(key);
      if (handlersForUnsubscribe) {
        handlersForUnsubscribe.delete(handler);
      }
    };
  }

  async publish<T>(message: Message<T>): Promise<void> {
    if (this.messageQueue.length >= this.options.maxQueueSize) {
      this.messageQueue.shift();
    }
    this.messageQueue.push(message);

    const handlers = this.handlers.get('*');
    const typeHandlers = this.handlers.get(message.type);

    const allHandlers = new Set([...(handlers ?? []), ...(typeHandlers ?? [])]);

    const promises: Array<Promise<void>> = [];
    for (const handler of allHandlers) {
      promises.push(Promise.resolve(handler(message)).catch((err: unknown) => {
        if (typeof console !== 'undefined') {
          console.error('Message handler error:', err);
        }
      }));
    }

    await Promise.all(promises);
  }

  async send<T>(message: Message<T>): Promise<void> {
    if (message.receiverId) {
      await this.publish(message);
    } else {
      throw new Error('Message must have a receiverId for direct send');
    }
  }

  async broadcast<T>(message: BroadcastMessage<T>): Promise<void> {
    await this.publish(message);
  }

  clear(): void {
    this.messageQueue = [];
    this.handlers.clear();
  }

  getQueueSize(): number {
    return this.messageQueue.length;
  }
}

export class Inbox {
  private messages: Map<AgentId, Message[]> = new Map();
  private unreadCount: Map<AgentId, number> = new Map();

  addMessage(agentId: AgentId, message: Message): void {
    const agentMessages = this.messages.get(agentId) ?? [];
    agentMessages.push(message);
    this.messages.set(agentId, agentMessages);
    
    const count = this.unreadCount.get(agentId) ?? 0;
    this.unreadCount.set(agentId, count + 1);
  }

  getMessages(agentId: AgentId, limit?: number): Message[] {
    const messages = this.messages.get(agentId) ?? [];
    return limit ? messages.slice(-limit) : messages;
  }

  getUnreadCount(agentId: AgentId): number {
    return this.unreadCount.get(agentId) ?? 0;
  }

  markAsRead(agentId: AgentId, messageId?: MessageId): void {
    if (messageId) {
      const messages = this.messages.get(agentId);
      if (messages) {
        const index = messages.findIndex((m) => m.id === messageId);
        if (index !== -1 && index < (this.unreadCount.get(agentId) ?? 0)) {
          const current = this.unreadCount.get(agentId) ?? 0;
          this.unreadCount.set(agentId, current - 1);
        }
      }
    } else {
      this.unreadCount.set(agentId, 0);
    }
  }

  clear(agentId: AgentId): void {
    this.messages.delete(agentId);
    this.unreadCount.delete(agentId);
  }
}
