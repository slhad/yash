import { beforeEach, describe, expect, test } from 'bun:test';
import { ObsService } from '../src/services/obs.service';

describe('ObsService', () => {
  let obsService: ObsService;

  beforeEach(() => {
    obsService = new ObsService('localhost', 4455, null);
  });

  test('should be instantiable', () => {
    expect(obsService).toBeInstanceOf(ObsService);
  });

  test('should start disconnected', () => {
    expect(obsService.isConnected()).toBe(false);
  });

  test('should connect and disconnect', async () => {
    await obsService.connect();
    expect(obsService.isConnected()).toBe(true);

    await obsService.disconnect();
    expect(obsService.isConnected()).toBe(false);
  });

  test('should not reconnect multiple times when already connecting', async () => {
    const connect1 = obsService.connect();
    const connect2 = obsService.connect();

    await connect1;
    expect(obsService.isConnected()).toBe(true);

    await connect2;
    expect(obsService.isConnected()).toBe(true);
  });

  test('should send requests when connected', async () => {
    await obsService.connect();

    const version = await obsService.getVersion();
    expect(version.obsVersion).toBeDefined();
    expect(version.obsPlatform).toBeDefined();

    const sceneList = await obsService.getSceneList();
    expect(sceneList.scenes).toBeDefined();
    expect(sceneList.currentProgramSceneName).toBeDefined();
  });

  test('should throw when sending requests while disconnected', async () => {
    await expect(obsService.sendRequest('GetVersion')).rejects.toThrow('Not connected to OBS');
    await expect(obsService.startStream()).rejects.toThrow('Not connected to OBS');
  });

  test('should handle convenience methods', async () => {
    await obsService.connect();

    await obsService.startStream();
    await obsService.stopStream();

    const status = await obsService.getStreamStatus();
    expect(status.outputActive).toBeDefined();

    const scenes = await obsService.getSceneList();
    expect(scenes.scenes).toHaveLength(2);
  });

  test('should set current scene', async () => {
    await obsService.connect();
    await obsService.setCurrentScene('Scene 1');
  });

  test('should notify status changes', async () => {
    let connectedStatus: boolean | null = null;
    const unsubscribe = obsService.subscribeToStatusChanges((connected) => {
      connectedStatus = connected;
    });

    await obsService.connect();
    expect(connectedStatus as unknown as boolean).toBe(true);

    await obsService.disconnect();
    expect(connectedStatus as unknown as boolean).toBe(false);

    unsubscribe();
  });

  test('should notify on messages', async () => {
    let messageReceived: any = null;
    const unsubscribe = obsService.subscribeToMessages((message) => {
      messageReceived = message;
    });

    await obsService.connect();

    expect(messageReceived).toBeNull();

    unsubscribe();
  });

  test('should unsubscribe from status changes', async () => {
    let callCount = 0;
    const unsubscribe = obsService.subscribeToStatusChanges(() => {
      callCount++;
    });

    await obsService.connect();
    const countAfterConnect = callCount;

    unsubscribe();
    await obsService.disconnect();
    expect(callCount).toBe(countAfterConnect);
  });

  test('should use custom host and port', () => {
    const customService = new ObsService('192.168.1.100', 4444, 'secret');
    expect(customService).toBeInstanceOf(ObsService);
  });
});
