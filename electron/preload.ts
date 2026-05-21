import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_CHANNELS,
  DesktopAPI,
  ChatMessage,
  ChatOptions,
  MCPServerConfig,
  StartBrowserLoginParams,
  AuthTokenReceivedPayload,
  ToolCall,
} from '../shared/types';

type IpcEvent = Electron.IpcRendererEvent;

function subscribe<Args extends unknown[]>(
  channel: string,
  callback: (...args: Args) => void
): () => void {
  const handler = (_event: IpcEvent, ...args: Args): void => callback(...args);
  ipcRenderer.on(channel, handler as (event: IpcEvent, ...args: unknown[]) => void);
  return () =>
    ipcRenderer.removeListener(
      channel,
      handler as (event: IpcEvent, ...args: unknown[]) => void
    );
}

const desktopAPI: DesktopAPI = {
  // Working directory
  selectWorkingDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNELS.SELECT_WORKING_DIR),
  getWorkingDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.GET_WORKING_DIR),
  setWorkingDirectoryByPath: (rootPath) =>
    ipcRenderer.invoke(IPC_CHANNELS.SET_WORKING_DIR_BY_PATH, rootPath),
  clearWorkingDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.CLEAR_WORKING_DIR),
  listWorkspaceFiles: () =>
    ipcRenderer.invoke(IPC_CHANNELS.LIST_WORKING_DIR_FILES),

  // Chat
  sendChat: (messages: ChatMessage[], options?: ChatOptions) =>
    ipcRenderer.invoke(IPC_CHANNELS.SEND_CHAT, messages, options),
  cancelChat: () => ipcRenderer.invoke(IPC_CHANNELS.CANCEL_CHAT),

  // Streaming events
  onChatStreamChunk: (callback) =>
    subscribe<[string]>(IPC_CHANNELS.CHAT_STREAM_CHUNK, callback),
  onChatStreamEnd: (callback) =>
    subscribe<[]>(IPC_CHANNELS.CHAT_STREAM_END, callback),
  onChatToolCall: (callback) =>
    subscribe<[ToolCall]>(IPC_CHANNELS.CHAT_TOOL_CALL, callback),

  // MCP
  mcpConnect: (configJson) =>
    ipcRenderer.invoke(IPC_CHANNELS.MCP_CONNECT, configJson),
  mcpDisconnect: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_DISCONNECT),
  mcpGetStatus: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_GET_STATUS),
  mcpGetConfig: () => ipcRenderer.invoke(IPC_CHANNELS.MCP_GET_CONFIG),
  mcpConnectServer: (name: string, config: MCPServerConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.MCP_CONNECT_SERVER, name, config),
  mcpDisconnectServer: (name) =>
    ipcRenderer.invoke(IPC_CHANNELS.MCP_DISCONNECT_SERVER, name),

  // Remote HTTP proxy
  remoteHttpRequest: (url, token, options) =>
    ipcRenderer.invoke(IPC_CHANNELS.REMOTE_HTTP_REQUEST, url, token, options),
  remoteStreamStart: (url, token, body) =>
    ipcRenderer.invoke(IPC_CHANNELS.REMOTE_STREAM_START, url, token, body),
  remoteStreamAbort: (streamId) =>
    ipcRenderer.invoke(IPC_CHANNELS.REMOTE_STREAM_ABORT, streamId),
  onRemoteStreamChunk: (callback) =>
    subscribe<[string, string]>(IPC_CHANNELS.REMOTE_STREAM_CHUNK, callback),
  onRemoteStreamEnd: (callback) =>
    subscribe<[string]>(IPC_CHANNELS.REMOTE_STREAM_END, callback),
  onRemoteStreamError: (callback) =>
    subscribe<[string, string]>(IPC_CHANNELS.REMOTE_STREAM_ERROR, callback),

  // Auth
  decodeToken: (token) => ipcRenderer.invoke(IPC_CHANNELS.TOKEN_DECODE, token),
  startBrowserLogin: (params: StartBrowserLoginParams) =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_START_BROWSER_LOGIN, params),
  onAuthTokenReceived: (callback) =>
    subscribe<[AuthTokenReceivedPayload]>(IPC_CHANNELS.AUTH_TOKEN_RECEIVED, callback),
  onAuthError: (callback) =>
    subscribe<[string]>(IPC_CHANNELS.AUTH_ERROR, callback),
};

contextBridge.exposeInMainWorld('desktopAPI', desktopAPI);
