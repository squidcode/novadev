import PusherJS from 'pusher-js';
import { api } from './api.js';
import { getActiveCredential } from './credentials.js';

export interface PusherClient {
  onTaskAvailable(cb: (data: { taskId: string; teamId: string; title: string }) => void): void;
  onOwnershipLost(cb: (data: { taskId: string }) => void): void;
  isConnected(): boolean;
  disconnect(): void;
}

export async function connectPusher(key: string, cluster: string): Promise<PusherClient | null> {
  const cred = getActiveCredential();
  if (!cred) return null;

  const channelName = `private-agent-${cred.agentId}`;

  const pusher = new PusherJS(key, {
    cluster,
    channelAuthorization: {
      transport: 'ajax',
      endpoint: '/unused',
      customHandler: (params, callback) => {
        api
          .pusherAuth(params.socketId, params.channelName)
          .then((data) => callback(null, data as { auth: string; channel_data?: string }))
          .catch((err) => callback(err instanceof Error ? err : new Error(String(err)), null));
      },
    },
  });

  // Wait for connection with 10s timeout
  const connected = await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => resolve(false), 10_000);

    pusher.connection.bind('connected', () => {
      clearTimeout(timeout);
      resolve(true);
    });

    pusher.connection.bind('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });

  if (!connected) {
    pusher.disconnect();
    return null;
  }

  const channel = pusher.subscribe(channelName);

  return {
    onTaskAvailable(cb) {
      channel.bind('task-available', cb);
    },
    onOwnershipLost(cb) {
      channel.bind('ownership-lost', cb);
    },
    isConnected() {
      return pusher.connection.state === 'connected';
    },
    disconnect() {
      pusher.disconnect();
    },
  };
}
