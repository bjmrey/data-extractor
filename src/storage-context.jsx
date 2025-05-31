import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { BrowserBackend, FolderBackend, ServerBackend, serverAvailable, folderSupported, getRememberedFolderHandle, rememberFolderHandle, copyAll } from './lib/storage.js';
import { setBackend, getBackend } from './lib/db.js';

const Ctx = createContext(null);

export function StorageProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0); // bump to make pages reload data
  const [label, setLabel] = useState('Browser storage');
  const [pendingHandle, setPendingHandle] = useState(null); // remembered folder that needs permission again
  const [notice, setNotice] = useState(null); // one-time message, e.g. after moving old data into data/

  const activate = useCallback((backend) => {
    setBackend(backend);
    setLabel(backend.label);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    (async () => {
      // Served by `npm run dev` / `npm run preview`: always use <project root>/data.
      if (await serverAvailable()) {
        const server = new ServerBackend();
        try {
          // First run with an empty data/ folder: bring over what the app had stored before.
          if ((await server.listAll()).length === 0) {
            const handle = folderSupported() ? await getRememberedFolderHandle() : null;
            const perm = handle ? await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied') : 'denied';
            const source = perm === 'granted' ? new FolderBackend(handle) : new BrowserBackend();
            const n = await copyAll(source, server);
            if (n) setNotice(`Copied ${n} existing file(s) from ${source.label.toLowerCase()} into data/.`);
          }
        } catch (e) {
          console.warn('Could not copy existing data into data/', e);
        }
        activate(server);
        setReady(true);
        return;
      }
      const handle = folderSupported() ? await getRememberedFolderHandle() : null;
      if (handle) {
        const perm = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
        if (perm === 'granted') activate(new FolderBackend(handle));
        else setPendingHandle(handle);
      }
      setReady(true);
    })();
  }, [activate]);

  const reconnect = useCallback(async () => {
    if (!pendingHandle) return;
    const perm = await pendingHandle.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      activate(new FolderBackend(pendingHandle));
      setPendingHandle(null);
    }
  }, [pendingHandle, activate]);

  /** Let the user pick a folder. If copyExisting, current data is copied into it first. */
  const chooseFolder = useCallback(
    async (copyExisting) => {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'financial-extractor' });
      const next = new FolderBackend(handle);
      let copied = 0;
      if (copyExisting) copied = await copyAll(getBackend(), next);
      await rememberFolderHandle(handle);
      setPendingHandle(null);
      activate(next);
      return copied;
    },
    [activate],
  );

  const useBrowser = useCallback(async () => {
    await rememberFolderHandle(null);
    setPendingHandle(null);
    activate(new BrowserBackend());
  }, [activate]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return (
    <Ctx.Provider value={{ ready, version, label, kind: getBackend().kind, pendingHandle, reconnect, chooseFolder, useBrowser, refresh, notice, dismissNotice: () => setNotice(null) }}>
      {ready ? children : null}
    </Ctx.Provider>
  );
}

export const useStorage = () => useContext(Ctx);

/** Load async data and reload whenever storage changes. */
export function useLoad(loader, deps = []) {
  const { version } = useStorage();
  const [state, setState] = useState({ loading: true, data: undefined, error: null });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    loader()
      .then((data) => alive && setState({ loading: false, data, error: null }))
      .catch((error) => alive && setState({ loading: false, data: undefined, error }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
