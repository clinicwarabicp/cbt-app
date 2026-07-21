// 患者側アプリ シェル: ハッシュルーティング+PINゲート(仕様書 §6)
// v1.3: ルートにクエリパラメータ対応(#/log?at=...、#/column?rid=...)、起動時に旧型移行

import { useEffect, useState } from 'preact/hooks';
import type { PatientSettings } from '@cbt/core';
import { getSettings, requestPersistence, runMigrations } from './db';
import { PinLock } from './screens/pin-lock';
import { Home } from './screens/home';
import { ActivityLogScreen } from './screens/activity-log';
import { ColumnScreen } from './screens/column';
import { HomeworkScreen } from './screens/homework';
import { ReviewScreen } from './screens/review';
import { TransferScreen } from './screens/transfer';
import { SettingsScreen } from './screens/settings';
import { SpikeScreen } from './screens/spike';

export interface Route {
  path: string;
  params: URLSearchParams;
}

function parseHash(): Route {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  return { path: path || '/', params: new URLSearchParams(query ?? '') };
}

function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash());
  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const [settings, setSettings] = useState<PatientSettings | null>(null);
  const [ready, setReady] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const reloadSettings = async () => setSettings(await getSettings());

  useEffect(() => {
    void (async () => {
      void requestPersistence(); // §3 ストレージ永続化要求
      await runMigrations(); // v1.3 旧型移行(冪等)
      await reloadSettings();
      setReady(true);
    })();
  }, []);

  if (!ready || !settings) return <p>読み込み中…</p>;

  if (settings.pin.enabled && settings.pin.hash && !unlocked) {
    return (
      <PinLock
        settings={settings}
        onUnlock={() => setUnlocked(true)}
        onWiped={() => {
          setUnlocked(true);
          void reloadSettings();
        }}
      />
    );
  }

  const screens: Record<string, () => ReturnType<typeof Home>> = {
    '/': () => <Home settings={settings} />,
    '/log': () => <ActivityLogScreen settings={settings} params={route.params} />,
    '/column': () => <ColumnScreen settings={settings} params={route.params} />,
    '/threecol': () => <ColumnScreen settings={settings} params={route.params} />, // 旧ルート互換
    '/homework': () => <HomeworkScreen settings={settings} />,
    '/review': () => <ReviewScreen />,
    '/transfer': () => <TransferScreen settings={settings} />,
    '/settings': () => <SettingsScreen settings={settings} onChanged={reloadSettings} />,
    '/spike': () => <SpikeScreen />,
  };

  const Screen = screens[route.path] ?? screens['/'];
  return <>{Screen!()}</>;
}
