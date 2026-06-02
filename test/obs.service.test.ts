import { beforeEach, describe, expect, test, vi } from 'bun:test';
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

  test('should expose current scene and scene item state helpers', async () => {
    await obsService.connect();

    await expect(obsService.getCurrentScene()).resolves.toBe('Scene 1');
    await expect(obsService.getInputSettings('Camera')).resolves.toEqual({});
    await expect(obsService.getSceneItemList('Scene 1')).resolves.toEqual([
      { sceneItemId: 7, sourceName: 'Camera', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
      { sceneItemId: 8, sourceName: 'Overlay', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
    ]);
    await expect(obsService.getSceneItemEnabled('Scene 1', 7)).resolves.toBe(true);
    await expect(obsService.getSceneItemTransform('Scene 1', 7)).resolves.toMatchObject({
      positionX: 0,
      positionY: 0,
      scaleX: 1,
      scaleY: 1,
    });
    await obsService.setSceneItemTransform('Scene 1', 7, { positionX: 25, positionY: 30 });
  });

  test('should resolve scene item state by source name', async () => {
    await obsService.connect();
    const sendRequestSpy = vi.spyOn(obsService, 'sendRequest');

    sendRequestSpy.mockImplementation(async (requestType, requestData) => {
      if (requestType === 'GetSceneItemId') return { sceneItemId: 42 };
      if (requestType === 'GetSceneItemEnabled') return { sceneItemEnabled: false };
      if (requestType === 'GetSceneItemTransform') {
        return { sceneItemTransform: { positionX: 12, positionY: 34 } };
      }
      return {};
    });

    await expect(obsService.getSceneItemState('Gameplay', 'Camera')).resolves.toEqual({
      sceneItemId: 42,
      sceneItemEnabled: false,
      sceneItemTransform: { positionX: 12, positionY: 34 },
    });

    expect(sendRequestSpy).toHaveBeenCalledWith('GetSceneItemId', {
      sceneName: 'Gameplay',
      sourceName: 'Camera',
    });
    expect(sendRequestSpy).toHaveBeenCalledWith('GetSceneItemEnabled', {
      sceneName: 'Gameplay',
      sceneItemId: 42,
    });
    expect(sendRequestSpy).toHaveBeenCalledWith('GetSceneItemTransform', {
      sceneName: 'Gameplay',
      sceneItemId: 42,
    });
  });

  test('should normalize scene item list responses', async () => {
    await obsService.connect();
    const sendRequestSpy = vi.spyOn(obsService, 'sendRequest');
    sendRequestSpy.mockResolvedValue({
      sceneItems: [
        { sceneItemId: 11, sourceName: 'Camera', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
        { sceneItemId: 12, sourceName: 'Scene Nest' },
        { sceneItemId: 'bad', sourceName: 'Ignore me' },
        { sceneItemId: 13 },
      ],
    });

    await expect(obsService.getSceneItemList('Gameplay')).resolves.toEqual([
      { sceneItemId: 11, sourceName: 'Camera', sourceType: 'OBS_SOURCE_TYPE_INPUT' },
      { sceneItemId: 12, sourceName: 'Scene Nest', sourceType: undefined },
    ]);

    expect(sendRequestSpy).toHaveBeenCalledWith('GetSceneItemList', {
      sceneName: 'Gameplay',
    });
  });

  test('should filter current scene change subscriptions', () => {
    const scenes: string[] = [];
    const unsubscribe = obsService.subscribeToCurrentSceneChanges((sceneName) => {
      scenes.push(sceneName);
    });

    (obsService as any).notifyMessages({ eventType: 'StreamStateChanged', eventData: {} });
    (obsService as any).notifyMessages({
      eventType: 'CurrentProgramSceneChanged',
      eventData: { sceneName: 'BRB' },
    });
    (obsService as any).notifyMessages({
      eventType: 'CurrentProgramSceneChanged',
      eventData: { sceneName: 'Gameplay' },
    });

    unsubscribe();
    (obsService as any).notifyMessages({
      eventType: 'CurrentProgramSceneChanged',
      eventData: { sceneName: 'Ignored' },
    });

    expect(scenes).toEqual(['BRB', 'Gameplay']);
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

  test('should only notify status callbacks on connection-state transitions', () => {
    const statuses: boolean[] = [];
    obsService.subscribeToStatusChanges((connected) => {
      statuses.push(connected);
    });

    (obsService as any).notifyStatusChangeIfChanged(false);
    (obsService as any).notifyStatusChangeIfChanged(false);
    (obsService as any).notifyStatusChangeIfChanged(true);
    (obsService as any).notifyStatusChangeIfChanged(true);
    (obsService as any).notifyStatusChangeIfChanged(false);

    expect(statuses).toEqual([false, true, false]);
  });

  test('should use custom host and port', () => {
    const customService = new ObsService('192.168.1.100', 4444, 'secret');
    expect(customService).toBeInstanceOf(ObsService);
  });
});
