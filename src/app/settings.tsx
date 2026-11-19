import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { sendAlert } from '@/lib/ntfy';
import { updateSettings, useSettings } from '@/lib/store';
import { Icon, Panel, SectionTitle, Tx } from '@/ui/kit';
import { C, F, GUTTER } from '@/ui/theme';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const st = useSettings();
  const [topic, setTopic] = useState(st.topic);
  const [server, setServer] = useState(st.server);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  async function test() {
    updateSettings({ topic: topic.trim(), server: server.trim() || 'https://ntfy.sh' });
    setTesting(true);
    const r = await sendAlert('Test alert from ParkWatch ✓', 'default', 'white_check_mark');
    setTesting(false);
    setTestResult(r.ok ? 'Sent. Check the ntfy app on your phone.' : r.error ?? 'Failed');
  }

  const quietOn = st.quietFrom != null && st.quietTo != null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: insets.top + 10, paddingHorizontal: GUTTER, paddingBottom: insets.bottom + 40 }}>
        <View style={s.bar}>
          <Pressable accessibilityLabel="Back" onPress={() => router.back()} hitSlop={8} style={s.back}>
            <Icon name="back" size={20} />
          </Pressable>
          <Tx style={{ fontFamily: F.bold, fontSize: 17 }}>Settings</Tx>
          <View style={{ width: 36 }} />
        </View>

        <SectionTitle title="Alerts" />
        <Panel>
          <Row label="ntfy topic" hint="Subscribe to the same topic in the ntfy app">
            <TextInput
              value={topic}
              onChangeText={setTopic}
              onEndEditing={() => updateSettings({ topic: topic.trim() })}
              placeholder="parking-x7k2q9"
              placeholderTextColor={C.faint}
              autoCapitalize="none"
              autoCorrect={false}
              style={[s.input, { width: 170 }]}
              selectionColor={C.blue}
            />
          </Row>
          <Row label="Server">
            <TextInput
              value={server}
              onChangeText={setServer}
              onEndEditing={() => updateSettings({ server: server.trim() || 'https://ntfy.sh' })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={[s.input, { width: 170 }]}
              selectionColor={C.blue}
            />
          </Row>
          <Row label="Also alert when taken">
            <Toggle value={st.notifyTaken} onChange={(v) => updateSettings({ notifyTaken: v })} />
          </Row>
          <Row label="Cooldown" hint="Minutes between alerts per spot">
            <Stepper value={st.cooldown} min={0} max={120} step={5} format={(v) => `${v} min`} onChange={(v) => updateSettings({ cooldown: v })} />
          </Row>
          <Row label="Quiet hours" hint={quietOn ? `${hh(st.quietFrom!)} – ${hh(st.quietTo!)}, no alerts` : 'Alerts at any time'}>
            <Toggle value={quietOn} onChange={(v) => updateSettings(v ? { quietFrom: 22, quietTo: 7 } : { quietFrom: null, quietTo: null })} />
          </Row>
          {quietOn && (
            <>
              <Row label="From">
                <Stepper value={st.quietFrom!} min={0} max={23} step={1} wrap format={hh} onChange={(v) => updateSettings({ quietFrom: v })} />
              </Row>
              <Row label="Until">
                <Stepper value={st.quietTo!} min={0} max={23} step={1} wrap format={hh} onChange={(v) => updateSettings({ quietTo: v })} />
              </Row>
            </>
          )}
          <Row label="Check it works" hint={testResult ?? undefined}>
            <Pressable onPress={test} disabled={testing} style={s.linkBtn}>
              {testing ? <ActivityIndicator size="small" color={C.blueText} /> : <Tx style={s.linkTx}>Send test</Tx>}
            </Pressable>
          </Row>
        </Panel>

        <SectionTitle title="Detection" />
        <Panel>
          <Row label="Check every" hint="Longer saves battery">
            <Stepper value={st.interval} min={5} max={120} step={5} format={(v) => `${v} s`} onChange={(v) => updateSettings({ interval: v })} />
          </Row>
          <Row label="Taken when covered" hint="White tick on each spot's meter">
            <Stepper value={Math.round(st.occ * 100)} min={5} max={90} step={5} format={(v) => `${v}%`} onChange={(v) => updateSettings({ occ: v / 100 })} />
          </Row>
          <Row label="Confirm after" hint="Checks in a row before a spot changes">
            <Stepper value={st.confirm} min={1} max={10} step={1} format={(v) => `${v}×`} onChange={(v) => updateSettings({ confirm: v })} />
          </Row>
          <Row label="Min. confidence" hint="Lower finds more cars, and more mistakes">
            <Stepper value={Math.round(st.minScore * 100)} min={20} max={90} step={5} format={(v) => `${v}%`} onChange={(v) => updateSettings({ minScore: v / 100 })} />
          </Row>
          <Row label="Show detected vehicles">
            <Toggle value={st.showBoxes} onChange={(v) => updateSettings({ showBoxes: v })} />
          </Row>
        </Panel>

        <SectionTitle title="Privacy" />
        <Panel>
          <Row label="Show camera image" hint="The camera keeps working when hidden">
            <Toggle value={st.showPreview} onChange={(v) => updateSettings({ showPreview: v })} />
          </Row>
          <Row label="Spots" hint={`${st.spots.length} marked`}>
            <Pressable
              disabled={!st.spots.length}
              onPress={() => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  setTimeout(() => setConfirmClear(false), 3000);
                  return;
                }
                updateSettings({ spots: [] });
                setConfirmClear(false);
              }}
              style={[s.linkBtn, { backgroundColor: 'rgba(248,113,113,0.1)' }]}
            >
              <Tx style={[s.linkTx, { color: C.taken }]}>{confirmClear ? 'Tap to confirm' : 'Delete all'}</Tx>
            </Pressable>
          </Row>
        </Panel>

        <SectionTitle title="Tips" />
        <Panel style={{ padding: 16, gap: 10 }}>
          {[
            'Mount the phone looking down at the street, plugged in.',
            'Use “Test detection” after marking spots: the blue corners should sit on the cars.',
            'Keep the app open. Use the moon button to black the screen; watching continues.',
            'Detection gets weaker in the dark.',
          ].map((t) => (
            <View key={t} style={{ flexDirection: 'row', gap: 10 }}>
              <Tx style={{ color: C.blue, fontFamily: F.bold }}>·</Tx>
              <Tx style={{ flex: 1, fontSize: 13.5, color: C.mute, lineHeight: 19 }}>{t}</Tx>
            </View>
          ))}
        </Panel>
      </ScrollView>
    </View>
  );
}

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Tx style={{ fontSize: 14.5 }}>{label}</Tx>
        {hint ? <Tx style={{ fontSize: 12, color: C.faint, marginTop: 1 }}>{hint}</Tx> : null}
      </View>
      {children}
    </View>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <Switch value={value} onValueChange={onChange} trackColor={{ false: C.surface2, true: C.blue }} thumbColor="#fff" />;
}

function Stepper({ value, min, max, step, format, onChange, wrap }: { value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void; wrap?: boolean }) {
  const go = (d: number) => {
    let v = value + d * step;
    if (wrap) v = v > max ? min : v < min ? max : v;
    else v = Math.min(max, Math.max(min, v));
    onChange(v);
  };
  return (
    <View style={s.stepper}>
      <Pressable accessibilityLabel="Less" onPress={() => go(-1)} hitSlop={4} style={s.stepBtn}>
        <Icon name="minus" size={16} color={C.mute} />
      </Pressable>
      <Tx style={s.stepVal}>{format(value)}</Tx>
      <Pressable accessibilityLabel="More" onPress={() => go(1)} hitSlop={4} style={s.stepBtn}>
        <Icon name="plus" size={16} color={C.mute} />
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface, borderWidth: 1, borderColor: C.hair },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56, borderTopWidth: 1, borderTopColor: C.hair, marginTop: -1 },
  input: { color: C.text, fontFamily: F.medium, fontSize: 14.5, backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, textAlign: 'right' },
  linkBtn: { backgroundColor: C.blueSoft, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, minWidth: 90, alignItems: 'center' },
  linkTx: { color: C.blueText, fontFamily: F.semibold, fontSize: 13.5 },
  stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface2, borderRadius: 10, padding: 3 },
  stepBtn: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  stepVal: { minWidth: 58, textAlign: 'center', fontFamily: F.semibold, fontSize: 14 },
});
