// 患者側アプリ シェル: ハッシュルーティング+PINゲート(仕様書 §6)

import { useEffect, useState } from 'preact/hooks';
import type { PatientSettings } from '@cbt/core';
import { getSettings, requestPersistence } from './db';
import { PinLock } from './screens/pin-lock';
import { Home } from './screens/home';
import { ActivityLogScreen } from './screens/activity-log';
import { ThreeColumnScreen } from './screens/three-column';
import { HomeworkScreen } from './screens/homework';
import { ReviewScreen } from './screens/review';
import { TransferScreen } from './screens/transfer';
import { SettingsScreen } from './screens/settings';
import { SpikeScreen } from './screens/spike';

function useHashRoute(): string {
  const [route, setRoute] = useState(location.hash.replace(/^#/, '') || '/');
  useEffect(() => {
    const onHash = () => setRoute(location.hash.replace(/^#/, '') || '/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route;
}

export function App() {
  const route = useHashRoute();
  const [settings, setSettings] = useState<PatientSettings | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const reloadSettings = async () => setSettings(await getSettings());

  useEffect(() => {
    void requestPersistence(); // §3 ストレージ永続化要求
    void reloadSettings();
  }, []);

  if (!settings) return <p>読み込み中…</p>;

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
    '/log': () => <ActivityLogScreen settings={settings} />,
    '/threecol': () => <ThreeColumnScreen settings={settings} />,
    '/homework': () => <HomeworkScreen settings={settings} />,
    '/review': () => <ReviewScreen />,
    '/transfer': () => <TransferScreen settings={settings} />,
    '/settings': () => <SettingsScreen settings={settings} onChanged={reloadSettings} />,
    '/spike': () => <SpikeScreen />,
  };

  const Screen = screens[route] ?? screens['/'];
  return <>{Screen!()}</>;
}
