'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('maxwell', {
    saveProfile:   (profile) => ipcRenderer.invoke('setup:save-profile', profile),
    saveApiKey:    (data)    => ipcRenderer.invoke('setup:save-api-key', data),
    completeSetup: ()        => ipcRenderer.send('setup:complete'),
    openExternal:  (url)     => ipcRenderer.send('open-external', url),
    platform:      process.platform,
    isElectron:    true,
});
