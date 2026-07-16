// PINロック画面(§3: PINは抑止であり暗号化ではない。リセット=全消去)

import { useState } from 'preact/hooks';
import type { PatientSettings } from '@cbt/core';
import { verifyPin, wipeAllData } from '../db';
import { Card } from '../components';

export function PinLock({
  settings,
  onUnlock,
  onWiped,
}: {
  settings: PatientSettings;
  onUnlock: () => void;
  onWiped: () => void;
}) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const tryUnlock = async (value: string) => {
    if (value.length !== 4 || !settings.pin.hash) return;
    if (await verifyPin(value, settings.pin.hash)) {
      onUnlock();
    } else {
      setError(true);
      setPin('');
    }
  };

  const forgot = async () => {
    const ok1 = confirm(
      'PINを忘れた場合の救済手段はありません。\nリセットするとアプリ内の記録・設定はすべて消去されます。\n(転送済みの記録は先生の端末に残っています)\n\n全消去してよろしいですか?',
    );
    if (!ok1) return;
    const ok2 = confirm('本当に全消去しますか? この操作は取り消せません。');
    if (!ok2) return;
    await wipeAllData();
    onWiped();
  };

  return (
    <Card title="PINを入力">
      <input
        class="pin-input"
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={4}
        value={pin}
        autoFocus
        onInput={(e) => {
          const v = e.currentTarget.value.replace(/\D/g, '');
          setPin(v);
          setError(false);
          if (v.length === 4) void tryUnlock(v);
        }}
      />
      {error && <p class="err">PINが違います</p>}
      <p class="note">
        PINを忘れた場合はデータ全消去でのリセットとなります(救済手段はありません)。
      </p>
      <button class="danger" onClick={() => void forgot()}>
        PINを忘れた(全消去してリセット)
      </button>
    </Card>
  );
}
